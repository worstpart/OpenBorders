/**
 * Accounts and profiles (milestone 3.7, D-037): what the browser and the server say to each
 * other about signing in, shared by both sides. Sign-in is optional — guests keep playing
 * with just a name (D-035).
 *
 * Two ways in: Google (the server talks to Google; we keep only Google's account number) or a
 * name + password with no email (a one-time recovery code replaces "forgot password" mails).
 * A profile shows the name, the join date, games played and wins — only online games with at
 * least two humans count.
 */
import { cleanName, MAX_NAME_LENGTH } from "./protocol.ts";
import { isBlockedName } from "./nameFilter.ts";

/** Where the account API lives (same origin as the page; the dev page asks port 8787). */
export const ACCOUNT_PATHS = {
  me: "/api/me",
  register: "/api/register",
  login: "/api/login",
  recover: "/api/recover",
  logout: "/api/logout",
  rename: "/api/rename",
  deleteAccount: "/api/delete",
  profile: "/api/profile",
  googleStart: "/auth/google",
  googleCallback: "/auth/google/callback",
} as const;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** Online games need this many humans to count on a profile (D-037). */
export const COUNTED_GAME_MIN_HUMANS = 2;

/** What everyone may see about an account. */
export interface PublicProfile {
  readonly name: string;
  /** When the account was made (ms since 1970). */
  readonly joined: number;
  readonly games: number;
  readonly wins: number;
}

/** The signed-in player's own account. */
export interface MyAccount extends PublicProfile {
  readonly method: "google" | "password";
  /** A new Google account still carries a made-up name: the page asks for one. */
  readonly needsName: boolean;
}

/** GET /api/me */
export interface MeResponse {
  readonly account: MyAccount | null;
  /** Google sign-in is set up on this server. */
  readonly google: boolean;
}

/** POST /api/register and /api/recover: the new recovery code is shown once. */
export interface CodeResponse {
  readonly account: MyAccount;
  readonly recoveryCode: string;
}

/** Any refused request. */
export interface ErrorResponse {
  readonly error: string;
}

/**
 * An account name (D-037): the lobby's name rules and blocklist (D-035), and never one that
 * looks like the lobby's stand-in names ("Player 3"). Returns the cleaned name or a reason.
 */
export function accountNameProblem(raw: unknown): { name: string } | { problem: string } {
  const name = cleanName(raw);
  if (!name) return { problem: "Names need a letter or a digit." };
  if (isBlockedName(name)) return { problem: "Please pick another name." };
  if (/^player \d+$/i.test(name)) return { problem: "Please pick a name of your own." };
  if (name.length < 2) return { problem: "Names need at least 2 characters." };
  return { name };
}

/** Two names that differ only in capitals are the same account name. */
export function nameKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/** Why a new password won't do, or null. */
export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== "string") return "Enter a password.";
  if (raw.length < MIN_PASSWORD_LENGTH) {
    return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (raw.length > MAX_PASSWORD_LENGTH) return "That password is too long.";
  return null;
}

export { MAX_NAME_LENGTH };
