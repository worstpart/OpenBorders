/**
 * The account API (3.7, D-037): sign up / in / out with a name and password, the recovery
 * code, Google sign-in, renaming, deleting, and public profiles — plain JSON over HTTP on
 * the game server's own address. No packages: cookies, rate limits and the Google exchange
 * are a few lines each.
 *
 * Safety, in short:
 * - The session key sits in an HttpOnly, SameSite=Lax cookie (Secure behind Railway's https);
 *   the database keeps only its SHA-256. Page scripts can't read it, other sites can't send it.
 * - Every change is a JSON POST whose Origin must be this site (other sites can't forge one).
 * - Sign-in attempts are rate-limited per address and per name; a wrong name takes as long
 *   as a wrong password.
 * - Google: authorization code with PKCE and a state cookie; we ask only for "openid", so
 *   Google tells us just its account number. The ID token comes straight from Google over
 *   https, so its claims are checked (issuer, audience, expiry) without a signature library.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ACCOUNT_PATHS,
  accountNameProblem,
  passwordProblem,
  type CodeResponse,
  type MeResponse,
  type MyAccount,
} from "../shared/accounts.ts";
import type { Account, AccountStore } from "./accountStore.ts";
import { SESSION_MS } from "./accountStore.ts";
import {
  DUMMY_HASH_PROMISE,
  hashPassword,
  newRecoveryCode,
  newSessionKey,
  normalizeRecoveryCode,
  sha256,
  verifyPassword,
} from "./passwords.ts";

export const SESSION_COOKIE = "ob_session";
const OAUTH_COOKIE = "ob_oauth";
const MAX_BODY_BYTES = 4 * 1024;
const OAUTH_WAIT_MS = 10 * 60 * 1000;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** The dev page (another port on this machine) may call a local server. */
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export interface GoogleConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface AccountApiOptions {
  readonly store: AccountStore;
  /** Behind Railway's https proxy: Secure cookies, no dev origins. */
  readonly behindProxy: boolean;
  /** The player's address, for rate limits. */
  readonly addressOf: (req: IncomingMessage) => string;
  /** Google sign-in, when set up (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). */
  readonly google?: GoogleConfig | null;
  /** This site's address as Google knows it (PUBLIC_ORIGIN); else from the request. */
  readonly publicOrigin?: string | null;
  readonly now?: () => number;
  /** For tests: Google's token endpoint. */
  readonly fetch?: typeof fetch;
  readonly log?: (line: string) => void;
}

/** Who a request or socket belongs to. */
export interface SignedIn {
  readonly id: number;
  readonly name: string;
}

/**
 * At most `limit` hits per key in `windowMs` (sliding). Keys are addresses or names; old
 * entries are forgotten as they age.
 */
export class RateLimit {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Counts a hit; false when the key is over its limit (the hit isn't counted then). */
  take(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((at) => now - at >= this.windowMs)) this.hits.delete(key);
    }
  }
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(eq + 1).trim());
  }
  return cookies;
}

class Refusal extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TOO_MANY = "Too many tries — wait a minute and try again.";

export class AccountApi {
  readonly googleEnabled: boolean;
  private readonly store: AccountStore;
  private readonly options: AccountApiOptions;
  private readonly now: () => number;
  private readonly fetch: typeof fetch;
  /** Sign-in, sign-up and recovery tries per address, and per account name. */
  private readonly triesPerAddress = new RateLimit(10, 60_000);
  private readonly triesPerName = new RateLimit(10, 15 * 60_000);
  private readonly signUpsPerAddress = new RateLimit(5, 60 * 60_000);
  private readonly renamesPerAccount = new RateLimit(10, 60 * 60_000);
  private readonly googlePerAddress = new RateLimit(20, 60_000);
  /** Google sign-ins on their way: state → what the callback needs. */
  private readonly pendingGoogle = new Map<
    string,
    { verifier: string; returnTo: string; redirectUri: string; expires: number }
  >();

  constructor(options: AccountApiOptions) {
    this.options = options;
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.fetch = options.fetch ?? fetch;
    this.googleEnabled = Boolean(options.google?.clientId && options.google.clientSecret);
  }

  /** Answers the request if it is an account route; false otherwise. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const isApi = Object.values(ACCOUNT_PATHS).includes(path as never);
    if (!isApi) return false;
    this.cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return true;
    }
    try {
      switch (path) {
        case ACCOUNT_PATHS.me:
          return await this.get(req, res, () => this.me(req, res));
        case ACCOUNT_PATHS.profile:
          return await this.get(req, res, () => {
            const profile = this.store.profile(url.searchParams.get("name") ?? "");
            if (!profile) throw new Refusal(404, "No account has that name.");
            return profile;
          });
        case ACCOUNT_PATHS.register:
          return await this.post(req, res, (body) => this.register(req, res, body));
        case ACCOUNT_PATHS.login:
          return await this.post(req, res, (body) => this.login(req, res, body));
        case ACCOUNT_PATHS.recover:
          return await this.post(req, res, (body) => this.recover(req, res, body));
        case ACCOUNT_PATHS.logout:
          return await this.post(req, res, () => {
            const key = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
            if (key) this.store.removeSession(sha256(key));
            this.setCookie(res, SESSION_COOKIE, "", 0, "/");
            return { account: null, google: this.googleEnabled } satisfies MeResponse;
          });
        case ACCOUNT_PATHS.rename:
          return await this.post(req, res, (body) => this.rename(req, body));
        case ACCOUNT_PATHS.deleteAccount:
          return await this.post(req, res, (body) => {
            const account = this.requireAccount(req);
            if ((body as { confirm?: unknown }).confirm !== true) {
              throw new Refusal(400, "Confirm to delete the account.");
            }
            this.store.deleteAccount(account.id);
            this.setCookie(res, SESSION_COOKIE, "", 0, "/");
            this.log(`account ${account.id} deleted`);
            return { account: null, google: this.googleEnabled } satisfies MeResponse;
          });
        case ACCOUNT_PATHS.googleStart:
          this.googleStart(req, res, url);
          return true;
        case ACCOUNT_PATHS.googleCallback:
          await this.googleCallback(req, res, url);
          return true;
      }
    } catch (error) {
      if (res.headersSent) return true;
      if (error instanceof Refusal) this.json(res, error.status, { error: error.message });
      else {
        this.log(`account api error: ${error instanceof Error ? error.stack : String(error)}`);
        this.json(res, 500, { error: "Something went wrong on the server." });
      }
    }
    return true;
  }

  /** The signed-in account a socket's upgrade request carries (only from this site). */
  accountFor(req: IncomingMessage): SignedIn | null {
    const origin = req.headers.origin;
    if (typeof origin !== "string" || !this.allowedOrigin(origin, req)) return null;
    const account = this.sessionOf(req)?.account;
    return account ? { id: account.id, name: account.name } : null;
  }

  // --- Routes ---------------------------------------------------------------------------

  private me(req: IncomingMessage, res: ServerResponse): MeResponse {
    const session = this.sessionOf(req);
    if (session?.renewed) {
      const key = parseCookies(req.headers.cookie).get(SESSION_COOKIE)!;
      this.setCookie(res, SESSION_COOKIE, key, SESSION_MS, "/");
    }
    return { account: session ? mine(session.account) : null, google: this.googleEnabled };
  }

  private async register(
    req: IncomingMessage,
    res: ServerResponse,
    body: Record<string, unknown>,
  ): Promise<CodeResponse> {
    const address = this.options.addressOf(req);
    const named = accountNameProblem(body["name"]);
    if ("problem" in named) throw new Refusal(400, named.problem);
    const problem = passwordProblem(body["password"]);
    if (problem) throw new Refusal(400, problem);
    const now = this.now();
    if (!this.triesPerAddress.take(address, now)) throw new Refusal(429, TOO_MANY);
    if (this.store.nameTaken(named.name)) throw new Refusal(409, "That name is taken.");
    if (!this.signUpsPerAddress.take(address, now)) {
      throw new Refusal(429, "Too many new accounts from here — try again later.");
    }
    const code = newRecoveryCode();
    const hash = await hashPassword(body["password"] as string);
    const account = this.store.createPasswordAccount(
      named.name,
      hash,
      sha256(normalizeRecoveryCode(code)),
      this.now(),
    );
    if (!account) throw new Refusal(409, "That name is taken.");
    this.signIn(res, account);
    this.log(`account ${account.id} created (password)`);
    return { account: mine(account), recoveryCode: code };
  }

  private async login(
    req: IncomingMessage,
    res: ServerResponse,
    body: Record<string, unknown>,
  ): Promise<MeResponse> {
    const name = typeof body["name"] === "string" ? body["name"] : "";
    const password = typeof body["password"] === "string" ? body["password"] : "";
    this.limitTries(req, name);
    const record = this.store.passwordRecord(name);
    const ok = await verifyPassword(password, record?.passwordHash ?? (await DUMMY_HASH_PROMISE));
    if (!record || !ok) throw new Refusal(401, "That name and password don't match.");
    this.signIn(res, record.account);
    return { account: mine(record.account), google: this.googleEnabled };
  }

  private async recover(
    req: IncomingMessage,
    res: ServerResponse,
    body: Record<string, unknown>,
  ): Promise<CodeResponse> {
    const name = typeof body["name"] === "string" ? body["name"] : "";
    const code = typeof body["code"] === "string" ? body["code"] : "";
    const problem = passwordProblem(body["password"]);
    if (problem) throw new Refusal(400, problem);
    this.limitTries(req, name);
    const record = this.store.passwordRecord(name);
    const given = Buffer.from(sha256(normalizeRecoveryCode(code)));
    const stored = Buffer.from(record?.recoveryHash ?? sha256(randomBytes(16).toString("hex")));
    if (!record || given.length !== stored.length || !timingSafeEqual(given, stored)) {
      throw new Refusal(401, "That name and recovery code don't match.");
    }
    // A new password and a new code; every other sign-in of the account ends.
    const next = newRecoveryCode();
    this.store.setPassword(
      record.account.id,
      await hashPassword(body["password"] as string),
      sha256(normalizeRecoveryCode(next)),
    );
    this.store.removeSessions(record.account.id);
    this.signIn(res, record.account);
    this.log(`account ${record.account.id} recovered`);
    return { account: mine(record.account), recoveryCode: next };
  }

  private rename(req: IncomingMessage, body: Record<string, unknown>): MeResponse {
    const account = this.requireAccount(req);
    const named = accountNameProblem(body["name"]);
    if ("problem" in named) throw new Refusal(400, named.problem);
    if (!this.renamesPerAccount.take(String(account.id), this.now())) {
      throw new Refusal(429, "Too many name changes — try again later.");
    }
    if (!this.store.rename(account.id, named.name)) throw new Refusal(409, "That name is taken.");
    return { account: mine(this.store.byId(account.id)!), google: this.googleEnabled };
  }

  private googleStart(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const google = this.options.google;
    if (!this.googleEnabled || !google) throw new Refusal(404, "Google sign-in isn't set up.");
    if (req.method !== "GET") throw new Refusal(405, "GET only.");
    const now = this.now();
    if (!this.googlePerAddress.take(this.options.addressOf(req), now)) {
      throw new Refusal(429, TOO_MANY);
    }
    for (const [state, pending] of this.pendingGoogle) {
      if (pending.expires <= now) this.pendingGoogle.delete(state);
    }
    if (this.pendingGoogle.size > 5_000) throw new Refusal(503, "Try again in a minute.");
    const state = randomBytes(16).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const redirectUri = `${this.publicOrigin(req)}${ACCOUNT_PATHS.googleCallback}`;
    this.pendingGoogle.set(state, {
      verifier,
      returnTo: this.safeReturn(url.searchParams.get("return"), req),
      redirectUri,
      expires: now + OAUTH_WAIT_MS,
    });
    const params = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    this.setCookie(res, OAUTH_COOKIE, state, OAUTH_WAIT_MS, "/auth/google");
    res.writeHead(302, { location: `${GOOGLE_AUTH_URL}?${params}` }).end();
  }

  private async googleCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const google = this.options.google;
    if (!this.googleEnabled || !google) throw new Refusal(404, "Google sign-in isn't set up.");
    const state = url.searchParams.get("state") ?? "";
    const pending = this.pendingGoogle.get(state);
    const cookieState = parseCookies(req.headers.cookie).get(OAUTH_COOKIE);
    this.setCookie(res, OAUTH_COOKIE, "", 0, "/auth/google");
    if (!pending || cookieState !== state || pending.expires <= this.now()) {
      // Stale or forged: start again from the page.
      res.writeHead(302, { location: this.safeReturn(null, req) + "#signin-failed" }).end();
      return;
    }
    this.pendingGoogle.delete(state);
    const back = (hash: string) => res.writeHead(302, { location: pending.returnTo + hash }).end();
    const code = url.searchParams.get("code");
    if (!code) return void back("#signin-cancelled");
    let sub: string;
    try {
      sub = await this.googleAccountNumber(google, code, pending.verifier, pending.redirectUri);
    } catch (error) {
      this.log(`google sign-in failed: ${error instanceof Error ? error.message : String(error)}`);
      return void back("#signin-failed");
    }
    let account = this.store.byGoogle(sub);
    if (!account) {
      // A stand-in name until the player picks one (the page asks right away).
      for (let tries = 0; !account && tries < 50; tries++) {
        const number = 1000 + (randomBytes(2).readUInt16LE(0) % 9000);
        account = this.store.createGoogleAccount(sub, `Commander ${number}`, this.now());
      }
      if (!account) return void back("#signin-failed");
      this.log(`account ${account.id} created (google)`);
    }
    this.signIn(res, account);
    back("#signed-in");
  }

  /** Swaps the code for Google's ID token and returns its account number ("sub"). */
  private async googleAccountNumber(
    google: GoogleConfig,
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<string> {
    const response = await this.fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const body = (await response.json()) as { id_token?: unknown; error?: unknown };
    if (!response.ok || typeof body.id_token !== "string") {
      throw new Error(`token endpoint said ${response.status} ${String(body.error ?? "")}`);
    }
    const payload = body.id_token.split(".")[1] ?? "";
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      iss?: unknown;
      aud?: unknown;
      exp?: unknown;
      sub?: unknown;
    };
    if (!GOOGLE_ISSUERS.includes(String(claims.iss))) throw new Error("wrong issuer");
    if (claims.aud !== google.clientId) throw new Error("wrong audience");
    if (typeof claims.exp !== "number" || claims.exp * 1000 < this.now()) {
      throw new Error("expired token");
    }
    if (typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 255) {
      throw new Error("no account number");
    }
    return claims.sub;
  }

  // --- Helpers --------------------------------------------------------------------------

  private sessionOf(req: IncomingMessage): { account: Account; renewed: boolean } | null {
    const key = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (!key || key.length > 100) return null;
    return this.store.sessionAccount(sha256(key), this.now());
  }

  private requireAccount(req: IncomingMessage): Account {
    const account = this.sessionOf(req)?.account;
    if (!account) throw new Refusal(401, "You're not signed in.");
    return account;
  }

  private signIn(res: ServerResponse, account: Account): void {
    const key = newSessionKey();
    this.store.addSession(sha256(key), account.id, this.now());
    this.setCookie(res, SESSION_COOKIE, key, SESSION_MS, "/");
  }

  /** Slows down guessing: per address and per account name. */
  private limitTries(req: IncomingMessage, name: string): void {
    const now = this.now();
    if (!this.triesPerAddress.take(this.options.addressOf(req), now)) {
      throw new Refusal(429, TOO_MANY);
    }
    if (!this.triesPerName.take(name.normalize("NFC").toLowerCase(), now)) {
      throw new Refusal(429, "Too many tries for this name — wait a few minutes.");
    }
  }

  private setCookie(
    res: ServerResponse,
    name: string,
    value: string,
    maxAgeMs: number,
    path: string,
  ): void {
    const parts = [
      `${name}=${value}`,
      `Path=${path}`,
      `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
      "HttpOnly",
      "SameSite=Lax",
    ];
    if (this.options.behindProxy) parts.push("Secure");
    const previous = res.getHeader("set-cookie");
    const list = Array.isArray(previous) ? previous : previous ? [String(previous)] : [];
    res.setHeader("set-cookie", [...list, parts.join("; ")]);
  }

  /** This site's own origin, as the browser sees it. */
  private selfOrigin(req: IncomingMessage): string {
    const proto = this.options.behindProxy
      ? String(req.headers["x-forwarded-proto"] ?? "https")
          .split(",")[0]!
          .trim()
      : "http";
    return `${proto}://${req.headers.host ?? "localhost"}`;
  }

  private publicOrigin(req: IncomingMessage): string {
    return this.options.publicOrigin?.replace(/\/$/, "") || this.selfOrigin(req);
  }

  private allowedOrigin(origin: string, req: IncomingMessage): boolean {
    if (origin === this.selfOrigin(req) || origin === this.publicOrigin(req)) return true;
    return !this.options.behindProxy && DEV_ORIGIN.test(origin);
  }

  /** The dev page lives on another port: let it call with its cookies. */
  private cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (typeof origin !== "string" || this.options.behindProxy || !DEV_ORIGIN.test(origin)) return;
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET, POST");
    res.setHeader("vary", "Origin");
  }

  /** Where to send the browser back after Google: a page of this site (or the dev page). */
  private safeReturn(raw: string | null, req: IncomingMessage): string {
    const home = `${this.publicOrigin(req)}/`;
    if (!raw) return home;
    try {
      const url = new URL(raw, home);
      if (!this.allowedOrigin(url.origin, req)) return home;
      return `${url.origin}${url.pathname}${url.search}`;
    } catch {
      return home;
    }
  }

  private async get(
    req: IncomingMessage,
    res: ServerResponse,
    answer: () => unknown,
  ): Promise<boolean> {
    if (req.method !== "GET") throw new Refusal(405, "GET only.");
    this.json(res, 200, answer());
    return true;
  }

  private async post(
    req: IncomingMessage,
    res: ServerResponse,
    answer: (body: Record<string, unknown>) => unknown,
  ): Promise<boolean> {
    if (req.method !== "POST") throw new Refusal(405, "POST only.");
    const origin = req.headers.origin;
    if (typeof origin !== "string" || !this.allowedOrigin(origin, req)) {
      throw new Refusal(403, "Requests must come from the game's page.");
    }
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
      throw new Refusal(415, "JSON only.");
    }
    const body = await readJson(req);
    this.json(res, 200, await answer(body));
    return true;
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res
      .writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
      .end(JSON.stringify(body));
  }

  private log(line: string): void {
    this.options.log?.(line);
  }
}

function mine(account: Account): MyAccount {
  return {
    name: account.name,
    joined: account.joined,
    games: account.games,
    wins: account.wins,
    method: account.method,
    needsName: account.needsName,
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Refusal(413, "Too much data.");
    chunks.push(chunk as Buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Refusal(400, "Bad JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Refusal(400, "Bad JSON.");
  }
  return body as Record<string, unknown>;
}
