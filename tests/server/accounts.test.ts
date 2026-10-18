/**
 * Milestone 3.7 (D-037): the account store, password and code hashing, the account API over
 * real HTTP (sign up, in, out, recovery, rename, delete, profiles, Google), and signed-in
 * players in lobbies (reserved names, counted games and wins).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAP_DIMENSIONS } from "../../src/sim/map/generate.ts";
import { AccountApi, RateLimit, parseCookies } from "../../src/server/accountApi.ts";
import { AccountStore, SESSION_MS } from "../../src/server/accountStore.ts";
import { Lobbies, type GameEvents, type Peer } from "../../src/server/lobbies.ts";
import {
  hashPassword,
  newRecoveryCode,
  normalizeRecoveryCode,
  sha256,
  verifyPassword,
} from "../../src/server/passwords.ts";
import { accountNameProblem, passwordProblem, type MeResponse } from "../../src/shared/accounts.ts";
import {
  PROTOCOL_VERSION,
  type GameConfig,
  type OnlineSettings,
  type ServerMessage,
} from "../../src/shared/protocol.ts";

describe("passwords and codes", () => {
  it("hashes passwords with a salt and checks them", async () => {
    const a = await hashPassword("correct horse");
    const b = await hashPassword("correct horse");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$32768$8$3$")).toBe(true);
    expect(await verifyPassword("correct horse", a)).toBe(true);
    expect(await verifyPassword("correct horsE", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("makes readable recovery codes and normalizes typed ones", () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    expect(code).not.toMatch(/[01IOL]/);
    expect(normalizeRecoveryCode(` ${code.toLowerCase().replaceAll("-", " ")} `)).toBe(
      code.replaceAll("-", ""),
    );
    expect(newRecoveryCode()).not.toBe(code);
  });

  it("checks names and passwords", () => {
    expect(accountNameProblem("  Ada   Lovelace ")).toEqual({ name: "Ada Lovelace" });
    expect(accountNameProblem("Player 3")).toHaveProperty("problem");
    expect(accountNameProblem("x")).toHaveProperty("problem");
    expect(accountNameProblem("@@@")).toHaveProperty("problem");
    expect(passwordProblem("short")).not.toBeNull();
    expect(passwordProblem("long enough")).toBeNull();
    expect(passwordProblem("x".repeat(129))).not.toBeNull();
  });

  it("rate-limits per key over a sliding window", () => {
    const limit = new RateLimit(2, 1000);
    expect(limit.take("a", 0)).toBe(true);
    expect(limit.take("a", 10)).toBe(true);
    expect(limit.take("a", 20)).toBe(false);
    expect(limit.take("b", 20)).toBe(true);
    expect(limit.take("a", 1001)).toBe(true);
  });

  it("reads cookies", () => {
    expect([...parseCookies("a=1; ob_session=xyz; b=")]).toEqual([
      ["a", "1"],
      ["ob_session", "xyz"],
      ["b", ""],
    ]);
  });
});

describe("the account store", () => {
  it("keeps names unique in any capitals, renames, counts, deletes", () => {
    const store = new AccountStore(":memory:");
    const ada = store.createPasswordAccount("Ada", "h", "r", 100)!;
    expect(ada).toMatchObject({ name: "Ada", method: "password", joined: 100, games: 0 });
    expect(store.createPasswordAccount("ADA", "h", "r", 100)).toBeNull();
    expect(store.ownerOfName("aDa")).toBe(ada.id);
    const g = store.createGoogleAccount("sub-1", "Commander 1234", 200)!;
    expect(g.needsName).toBe(true);
    expect(store.byGoogle("sub-1")?.id).toBe(g.id);
    expect(store.rename(g.id, "ada")).toBe(false);
    expect(store.rename(g.id, "Grace")).toBe(true);
    expect(store.byId(g.id)).toMatchObject({ name: "Grace", needsName: false });
    expect(store.nameTaken("Commander 1234")).toBe(false);
    store.recordGame([ada.id, g.id]);
    store.recordWin([g.id]);
    expect(store.profile("grace")).toEqual({ name: "Grace", joined: 200, games: 1, wins: 1 });
    store.addSession("k", g.id, 0);
    store.deleteAccount(g.id);
    expect(store.profile("Grace")).toBeNull();
    expect(store.sessionAccount("k", 1)).toBeNull();
    expect(store.accountCount).toBe(1);
  });

  it("expires sessions after 30 days unless used, renewing at most daily", () => {
    const store = new AccountStore(":memory:");
    const id = store.createPasswordAccount("Ada", "h", "r", 0)!.id;
    store.addSession("k", id, 0);
    expect(store.sessionAccount("k", 1000)?.renewed).toBe(false);
    const day = 24 * 60 * 60 * 1000;
    expect(store.sessionAccount("k", 2 * day)?.renewed).toBe(true);
    // Renewed at day 2: still good at day 31, gone after day 32.
    expect(store.sessionAccount("k", 2 * day + SESSION_MS - 1)?.account.id).toBe(id);
    store.addSession("old", id, 0);
    store.pruneSessions(SESSION_MS + 1);
    expect(store.sessionAccount("old", SESSION_MS + 2)).toBeNull();
  });
});

describe("the account API", () => {
  let store: AccountStore;
  let server: Server;
  let base: string;
  let now = 1_000_000;
  let googleCalls: URLSearchParams[] = [];
  let idToken: Record<string, unknown> = {};

  beforeEach(async () => {
    store = new AccountStore(":memory:");
    googleCalls = [];
    const api = new AccountApi({
      store,
      behindProxy: false,
      addressOf: (req) => String(req.headers["x-test-address"] ?? "1.1.1.1"),
      google: { clientId: "client-1", clientSecret: "secret-1" },
      now: () => now,
      fetch: (async (_url: string, init: { body: URLSearchParams }) => {
        googleCalls.push(init.body);
        const payload = Buffer.from(JSON.stringify(idToken)).toString("base64url");
        return new Response(JSON.stringify({ id_token: `x.${payload}.y` }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    server = createServer((req, res) => {
      void api.handle(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((done) => server.close(done));
    store.close();
  });

  /** A browser: keeps its cookie between requests. */
  function browser(address = "1.1.1.1") {
    let cookie = "";
    const take = (response: Response) => {
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(";");
        const [name, value] = pair!.split("=");
        if (name === "ob_session") cookie = value ? `ob_session=${value}` : "";
      }
      return response;
    };
    return {
      get cookie() {
        return cookie;
      },
      get: async (path: string) =>
        take(await fetch(base + path, { headers: { cookie, "x-test-address": address } })),
      post: async (path: string, body: unknown, origin = "http://localhost:5173") =>
        take(
          await fetch(base + path, {
            method: "POST",
            headers: {
              cookie,
              origin,
              "content-type": "application/json",
              "x-test-address": address,
            },
            body: JSON.stringify(body),
          }),
        ),
    };
  }

  it("signs up, stays signed in, signs out and back in", async () => {
    const b = browser();
    expect(((await (await b.get("/api/me")).json()) as MeResponse).account).toBeNull();
    const made = await b.post("/api/register", { name: " Ada ", password: "lovelace1" });
    expect(made.status).toBe(200);
    const body = (await made.json()) as { account: { name: string }; recoveryCode: string };
    expect(body.account.name).toBe("Ada");
    expect(body.recoveryCode).toMatch(/^[A-Z2-9-]{23}$/);
    expect(made.headers.getSetCookie()[0]).toMatch(/HttpOnly; SameSite=Lax/);
    const me = (await (await b.get("/api/me")).json()) as MeResponse;
    expect(me).toMatchObject({ account: { name: "Ada", method: "password" }, google: true });
    // Signing out ends the session on the server too.
    const key = b.cookie;
    await b.post("/api/logout", {});
    expect(b.cookie).toBe("");
    const stale = await fetch(base + "/api/me", { headers: { cookie: key } });
    expect(((await stale.json()) as MeResponse).account).toBeNull();
    expect((await b.post("/api/login", { name: "ada", password: "wrong pass" })).status).toBe(401);
    expect((await b.post("/api/login", { name: "nobody", password: "lovelace1" })).status).toBe(
      401,
    );
    expect((await b.post("/api/login", { name: "ADA", password: "lovelace1" })).status).toBe(200);
    expect(((await (await b.get("/api/me")).json()) as MeResponse).account?.name).toBe("Ada");
  });

  it("refuses taken names, bad input, other sites and non-JSON", async () => {
    const b = browser();
    await b.post("/api/register", { name: "Ada", password: "lovelace1" });
    expect(
      (await browser().post("/api/register", { name: "ADA", password: "x".repeat(9) })).status,
    ).toBe(409);
    expect((await browser().post("/api/register", { name: "Bo", password: "short" })).status).toBe(
      400,
    );
    const evil = await browser().post(
      "/api/login",
      { name: "Ada", password: "lovelace1" },
      "https://evil.example",
    );
    expect(evil.status).toBe(403);
    const form = await fetch(base + "/api/login", {
      method: "POST",
      headers: { origin: "http://localhost:5173", "content-type": "text/plain" },
      body: "{}",
    });
    expect(form.status).toBe(415);
    expect((await b.get("/api/register")).status).toBe(405);
  });

  it("limits sign-in tries per address and per name", async () => {
    await browser().post("/api/register", { name: "Ada", password: "lovelace1" });
    now += 3_600_000;
    const guesser = browser("6.6.6.6");
    const statuses: number[] = [];
    for (let k = 0; k < 11; k++) {
      statuses.push(
        (await guesser.post("/api/login", { name: "Ada", password: `guess${k}xx` })).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    // From another address the name itself is now limited (10 tries in 15 minutes).
    expect(
      (await browser("7.7.7.7").post("/api/login", { name: "ada", password: "lovelace1" })).status,
    ).toBe(429);
    now += 15 * 60_000;
    expect(
      (await browser("7.7.7.7").post("/api/login", { name: "ada", password: "lovelace1" })).status,
    ).toBe(200);
  });

  it("recovers with the code: new password, new code, other sign-ins end", async () => {
    const first = browser();
    const made = (await (
      await first.post("/api/register", { name: "Ada", password: "lovelace1" })
    ).json()) as {
      recoveryCode: string;
    };
    const other = browser("2.2.2.2");
    const wrong = await other.post("/api/recover", {
      name: "Ada",
      code: "AAAAA-AAAAA-AAAAA-AAAAA",
      password: "newpass12",
    });
    expect(wrong.status).toBe(401);
    const typed = made.recoveryCode.toLowerCase().replaceAll("-", " ");
    const ok = await other.post("/api/recover", {
      name: "ada",
      code: typed,
      password: "newpass12",
    });
    expect(ok.status).toBe(200);
    const next = ((await ok.json()) as { recoveryCode: string }).recoveryCode;
    expect(next).not.toBe(made.recoveryCode);
    expect(((await (await first.get("/api/me")).json()) as MeResponse).account).toBeNull();
    expect(
      (await browser("3.3.3.3").post("/api/login", { name: "Ada", password: "lovelace1" })).status,
    ).toBe(401);
    expect(
      (await browser("3.3.3.3").post("/api/login", { name: "Ada", password: "newpass12" })).status,
    ).toBe(200);
    // The old code is used up.
    expect(
      (
        await browser("4.4.4.4").post("/api/recover", {
          name: "Ada",
          code: made.recoveryCode,
          password: "another12",
        })
      ).status,
    ).toBe(401);
  });

  it("renames, shows public profiles, deletes at once", async () => {
    const b = browser();
    await b.post("/api/register", { name: "Ada", password: "lovelace1" });
    await browser("2.2.2.2").post("/api/register", { name: "Grace", password: "hopper123" });
    expect((await b.post("/api/rename", { name: "grace" })).status).toBe(409);
    const renamed = await b.post("/api/rename", { name: "Countess" });
    expect(((await renamed.json()) as MeResponse).account?.name).toBe("Countess");
    const profile = await (await browser().get("/api/profile?name=countess")).json();
    expect(profile).toEqual({ name: "Countess", joined: now, games: 0, wins: 0 });
    expect(Object.keys(profile as object)).toEqual(["name", "joined", "games", "wins"]);
    expect((await browser().get("/api/profile?name=Ada")).status).toBe(404);
    expect((await b.post("/api/delete", {})).status).toBe(400);
    expect((await b.post("/api/delete", { confirm: true })).status).toBe(200);
    expect(b.cookie).toBe("");
    expect((await browser().get("/api/profile?name=Countess")).status).toBe(404);
    expect(store.accountCount).toBe(1);
    expect((await browser().post("/api/rename", { name: "X1" })).status).toBe(401);
  });

  it("signs in with Google: state cookie, PKCE, only Google's number kept", async () => {
    const start = await fetch(
      `${base}/auth/google?return=${encodeURIComponent("http://localhost:5173/?game=abc")}`,
      {
        redirect: "manual",
      },
    );
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("scope")).toBe("openid");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    const state = to.searchParams.get("state")!;
    const stateCookie = start.headers.getSetCookie()[0]!.split(";")[0]!;
    expect(stateCookie).toBe(`ob_oauth=${state}`);

    // Without the browser's state cookie (a forged link): refused.
    const forged = await fetch(`${base}/auth/google/callback?state=${state}&code=c`, {
      redirect: "manual",
    });
    expect(forged.headers.get("location")).toMatch(/#signin-failed$/);

    // A real round trip.
    const again = await fetch(`${base}/auth/google?return=/`, { redirect: "manual" });
    const state2 = new URL(again.headers.get("location")!).searchParams.get("state")!;
    idToken = {
      iss: "https://accounts.google.com",
      aud: "client-1",
      exp: now / 1000 + 600,
      sub: "g-42",
    };
    const back = await fetch(`${base}/auth/google/callback?state=${state2}&code=the-code`, {
      redirect: "manual",
      headers: { cookie: `ob_oauth=${state2}` },
    });
    expect(back.headers.get("location")).toBe(`${base}/#signed-in`);
    expect(googleCalls[0]!.get("code")).toBe("the-code");
    expect(googleCalls[0]!.get("code_verifier")).toMatch(/^[\w-]{43}$/);
    const session = back.headers.getSetCookie().find((c) => c.startsWith("ob_session="))!;
    const me = (await (
      await fetch(`${base}/api/me`, { headers: { cookie: session.split(";")[0]! } })
    ).json()) as MeResponse;
    expect(me.account).toMatchObject({ method: "google", needsName: true });
    expect(me.account?.name).toMatch(/^Commander \d{4}$/);
    expect(store.byGoogle("g-42")).not.toBeNull();

    // A token for another app is refused.
    const third = await fetch(`${base}/auth/google?return=/`, { redirect: "manual" });
    const state3 = new URL(third.headers.get("location")!).searchParams.get("state")!;
    idToken = { ...idToken, aud: "someone-else", sub: "g-99" };
    const bad = await fetch(`${base}/auth/google/callback?state=${state3}&code=x`, {
      redirect: "manual",
      headers: { cookie: `ob_oauth=${state3}` },
    });
    expect(bad.headers.get("location")).toMatch(/#signin-failed$/);
    expect(store.byGoogle("g-99")).toBeNull();
  });

  it("only sends the browser back to this site", async () => {
    const start = await fetch(
      `${base}/auth/google?return=${encodeURIComponent("https://evil.example/x")}`,
      {
        redirect: "manual",
      },
    );
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const cancelled = await fetch(
      `${base}/auth/google/callback?state=${state}&error=access_denied`,
      {
        redirect: "manual",
        headers: { cookie: `ob_oauth=${state}` },
      },
    );
    expect(cancelled.headers.get("location")).toBe(`${base}/#signin-cancelled`);
  });
});

describe("signed-in players in lobbies", () => {
  const SETTINGS: OnlineSettings = {
    map: { seed: 1, ...MAP_DIMENSIONS.normal, style: "continent" },
    mode: "ffa",
    teams: 0,
    difficulty: "medium",
    nations: ["Avalon"],
    tribes: [],
  };

  function setup() {
    const store = new AccountStore(":memory:");
    const ada = store.createPasswordAccount("Ada", "h", sha256("r"), 0)!;
    const grace = store.createPasswordAccount("Grace", "h", sha256("r"), 0)!;
    const runners: { config: GameConfig; events: GameEvents }[] = [];
    let ids = 0;
    const lobbies = new Lobbies({
      startRunner: (config, events) => {
        runners.push({ config, events });
        return { command: () => {}, snapshot: () => {}, stop: () => {} };
      },
      newGameId: () => `g${++ids}`,
      newSeed: () => 1,
      newToken: () => `t${Math.random()}`,
      schedule: () => () => {},
      accounts: {
        reserved: (name, accountId) => {
          const owner = store.ownerOfName(name);
          return owner !== null && owner !== accountId;
        },
        played: (list) => store.recordGame(list),
        won: (list) => store.recordWin(list),
      },
    });
    const connect = (account: { id: number; name: string } | null) => {
      const inbox: ServerMessage[] = [];
      const peer: Peer = {
        send: (m) => inbox.push(m),
        sendText: (t) => inbox.push(JSON.parse(t) as ServerMessage),
        close: () => {},
      };
      const connection = lobbies.connect(peer, "", account);
      connection.receive({ t: "hello", version: PROTOCOL_VERSION });
      const lobby = () => {
        const m = inbox.filter((x) => x.t === "lobby").at(-1);
        if (m?.t !== "lobby") throw new Error("no lobby");
        return m;
      };
      return { inbox, connection, lobby };
    };
    return { store, ada, grace, runners, connect };
  }

  it("plays under the account's name; guests can't take an account's name", () => {
    const { ada, connect } = setup();
    const a = connect({ id: ada.id, name: "Ada" });
    a.connection.receive({ t: "create", settings: SETTINGS, name: "Whatever" });
    const guest = connect(null);
    guest.connection.receive({ t: "join", gameId: "g1", name: "ada" });
    const other = connect(null);
    other.connection.receive({ t: "join", gameId: "g1", name: "Grace" });
    const players = guest.lobby().players;
    expect(players.map((p) => [p.name, p.profile])).toEqual([
      ["Ada", "Ada"],
      ["ada (2)", null],
      ["Grace (2)", null],
    ]);
    // Renaming: refused for the account holder, a reserved name gets a suffix for a guest.
    a.connection.receive({ t: "name", name: "Lady A" });
    expect(a.inbox.at(-1)).toMatchObject({ t: "error" });
    other.connection.receive({ t: "name", name: "GRACE" });
    expect(other.lobby().players[2]!.name).toBe("GRACE (2)");
  });

  it("counts games with two or more humans, and the winner's win", () => {
    const { store, ada, grace, runners, connect } = setup();
    // Alone against bots: not counted.
    const solo = connect({ id: ada.id, name: "Ada" });
    solo.connection.receive({ t: "create", settings: SETTINGS, name: "" });
    solo.connection.receive({ t: "start" });
    runners[0]!.events.ended(undefined, { winner: 1, team: 0 });
    expect(store.profile("Ada")).toMatchObject({ games: 0, wins: 0 });

    const a = connect({ id: ada.id, name: "Ada" });
    a.connection.receive({ t: "create", settings: SETTINGS, name: "" });
    const g = connect({ id: grace.id, name: "Grace" });
    g.connection.receive({ t: "join", gameId: "g2", name: "" });
    const guest = connect(null);
    guest.connection.receive({ t: "join", gameId: "g2", name: "Bob" });
    a.connection.receive({ t: "start" });
    expect(store.profile("Ada")).toMatchObject({ games: 1, wins: 0 });
    expect(store.profile("Grace")).toMatchObject({ games: 1, wins: 0 });
    runners[1]!.events.ended(undefined, { winner: 2, team: 0 });
    // Ended twice (should never happen) still counts once.
    runners[1]!.events.ended(undefined, { winner: 2, team: 0 });
    expect(store.profile("Grace")).toMatchObject({ games: 1, wins: 1 });
    expect(store.profile("Ada")).toMatchObject({ games: 1, wins: 0 });
  });

  it("a team win counts for every signed-in player on the team", () => {
    const { store, ada, grace, runners, connect } = setup();
    const teams: OnlineSettings = {
      ...SETTINGS,
      mode: "teams",
      teams: 2,
      nations: ["Avalon", "Borea"],
    };
    const a = connect({ id: ada.id, name: "Ada" });
    a.connection.receive({ t: "create", settings: teams, name: "" });
    const g = connect({ id: grace.id, name: "Grace" });
    g.connection.receive({ t: "join", gameId: "g1", name: "" });
    g.connection.receive({ t: "team", team: 1 });
    a.connection.receive({ t: "start" });
    runners[0]!.events.ended(undefined, { winner: 3, team: 1 });
    expect(store.profile("Ada")).toMatchObject({ games: 1, wins: 1 });
    expect(store.profile("Grace")).toMatchObject({ games: 1, wins: 1 });
  });
});
