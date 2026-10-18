/**
 * The signed-in player in the browser (3.7, D-037): who is signed in (asked from the server
 * at start-up), and the account calls the start screen's dialogs make. The session key is an
 * HttpOnly cookie, so this page never sees it — it only sends requests "with credentials".
 */
import {
  ACCOUNT_PATHS,
  type CodeResponse,
  type MeResponse,
  type MyAccount,
  type PublicProfile,
} from "../../shared/accounts.ts";
import { serverHttpBase } from "./online.ts";

export interface AccountState {
  /** Null: a guest. */
  me: MyAccount | null;
  /** The server offers Google sign-in. */
  google: boolean;
  /** The first answer from the server came (until then the start screen shows nothing). */
  loaded: boolean;
  /** Something to say once, e.g. after coming back from Google. */
  notice: string | null;
}

export const account: AccountState = $state({
  me: null,
  google: false,
  loaded: false,
  notice: null,
});

/** A refused account request: the server's reason, ready to show. */
export class AccountError extends Error {}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${serverHttpBase()}${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      cache: "no-store",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AccountError("Can't reach the game server.");
  }
  const json = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !json) throw new AccountError(json?.error ?? "Something went wrong.");
  return json;
}

function took(me: MeResponse): void {
  account.me = me.account;
  account.google = me.google;
  account.loaded = true;
}

/**
 * Asks the server who is signed in, and reads what Google's round trip left in the address
 * bar (#signed-in / #signin-failed / #signin-cancelled).
 */
export async function loadAccount(): Promise<void> {
  const hash = location.hash;
  if (hash === "#signin-failed") account.notice = "Google sign-in didn't work — try again.";
  if (hash.startsWith("#signed-in") || hash.startsWith("#signin-")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  try {
    took(await call<MeResponse>(ACCOUNT_PATHS.me));
  } catch {
    // No server (or offline): everyone plays as a guest.
    account.loaded = true;
  }
}

export async function register(name: string, password: string): Promise<string> {
  const reply = await call<CodeResponse>(ACCOUNT_PATHS.register, { name, password });
  account.me = reply.account;
  return reply.recoveryCode;
}

export async function signIn(name: string, password: string): Promise<void> {
  took(await call<MeResponse>(ACCOUNT_PATHS.login, { name, password }));
}

/** A new password from the recovery code; returns the next code (the old one is used up). */
export async function recover(name: string, code: string, password: string): Promise<string> {
  const reply = await call<CodeResponse>(ACCOUNT_PATHS.recover, { name, code, password });
  account.me = reply.account;
  return reply.recoveryCode;
}

export async function signOut(): Promise<void> {
  took(await call<MeResponse>(ACCOUNT_PATHS.logout, {}));
}

export async function rename(name: string): Promise<void> {
  took(await call<MeResponse>(ACCOUNT_PATHS.rename, { name }));
}

export async function deleteAccount(): Promise<void> {
  took(await call<MeResponse>(ACCOUNT_PATHS.deleteAccount, { confirm: true }));
}

export async function fetchProfile(name: string): Promise<PublicProfile> {
  return call<PublicProfile>(`${ACCOUNT_PATHS.profile}?name=${encodeURIComponent(name)}`);
}

/** Leaves for Google's sign-in page; Google sends the browser back to this page. */
export function signInWithGoogle(): void {
  const back = `${location.origin}${location.pathname}${location.search}`;
  location.assign(
    `${serverHttpBase()}${ACCOUNT_PATHS.googleStart}?return=${encodeURIComponent(back)}`,
  );
}

/** "12 Oct 2026". */
export function joinedDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
