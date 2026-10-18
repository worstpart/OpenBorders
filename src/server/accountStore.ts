/**
 * Where accounts live (3.7, D-037): one SQLite file (Node's built-in node:sqlite — no
 * package, no database server), on a Railway volume in production so it survives updates.
 *
 * Kept per account: the name, Google's account number *or* the scrambled password and
 * recovery code, the join date and two counts. No email, no Google name or photo, no
 * addresses. Sessions are stored as hashes of their keys. Deleting an account deletes its
 * row and its sessions; nothing else refers to it.
 */
import { DatabaseSync } from "node:sqlite";
import { nameKey, type MyAccount, type PublicProfile } from "../shared/accounts.ts";

/** How long a sign-in lasts without being used (D-037: 30 days). */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** A session used again is pushed back to the full 30 days at most once a day. */
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;

interface AccountRow {
  id: number;
  name: string;
  method: "google" | "password";
  google_sub: string | null;
  password_hash: string | null;
  recovery_hash: string | null;
  needs_name: number;
  joined: number;
  games: number;
  wins: number;
}

export interface Account extends MyAccount {
  readonly id: number;
}

export interface PasswordRecord {
  readonly account: Account;
  readonly passwordHash: string;
  readonly recoveryHash: string;
}

const SCHEMA_VERSION = 1;

export class AccountStore {
  private readonly db: DatabaseSync;

  /** `path` ":memory:" for tests. */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 2000");
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version;
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL UNIQUE,
          method TEXT NOT NULL CHECK (method IN ('google', 'password')),
          google_sub TEXT UNIQUE,
          password_hash TEXT,
          recovery_hash TEXT,
          needs_name INTEGER NOT NULL DEFAULT 0,
          joined INTEGER NOT NULL,
          games INTEGER NOT NULL DEFAULT 0,
          wins INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sessions (
          key_hash TEXT PRIMARY KEY,
          account_id INTEGER NOT NULL,
          expires INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_by_account ON sessions (account_id);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    }
  }

  close(): void {
    this.db.close();
  }

  // --- Accounts -------------------------------------------------------------------------

  /** A new name + password account, or null when the name is taken. */
  createPasswordAccount(
    name: string,
    passwordHash: string,
    recoveryHash: string,
    now: number,
  ): Account | null {
    if (this.nameTaken(name)) return null;
    const result = this.db
      .prepare(
        `INSERT INTO accounts (name, name_key, method, password_hash, recovery_hash, joined)
         VALUES (?, ?, 'password', ?, ?, ?)`,
      )
      .run(name, nameKey(name), passwordHash, recoveryHash, now);
    return this.byId(Number(result.lastInsertRowid));
  }

  /** A new Google account under a stand-in name (the player picks theirs next). */
  createGoogleAccount(googleSub: string, name: string, now: number): Account | null {
    if (this.nameTaken(name)) return null;
    const result = this.db
      .prepare(
        `INSERT INTO accounts (name, name_key, method, google_sub, needs_name, joined)
         VALUES (?, ?, 'google', ?, 1, ?)`,
      )
      .run(name, nameKey(name), googleSub, now);
    return this.byId(Number(result.lastInsertRowid));
  }

  byId(id: number): Account | null {
    return toAccount(this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
  }

  byGoogle(googleSub: string): Account | null {
    return toAccount(this.db.prepare("SELECT * FROM accounts WHERE google_sub = ?").get(googleSub));
  }

  /** A password account by name (any capitals), with its hashes — for signing in. */
  passwordRecord(name: string): PasswordRecord | null {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE name_key = ? AND method = 'password'")
      .get(nameKey(name)) as AccountRow | undefined;
    if (!row?.password_hash || !row.recovery_hash) return null;
    return {
      account: toAccount(row)!,
      passwordHash: row.password_hash,
      recoveryHash: row.recovery_hash,
    };
  }

  /** Whether an account has this name (any capitals). */
  nameTaken(name: string): boolean {
    return this.ownerOfName(name) !== null;
  }

  /** The id of the account named `name` (any capitals), or null. */
  ownerOfName(name: string): number | null {
    const row = this.db.prepare("SELECT id FROM accounts WHERE name_key = ?").get(nameKey(name)) as
      { id: number } | undefined;
    return row?.id ?? null;
  }

  /** What everyone may see, by name (any capitals). */
  profile(name: string): PublicProfile | null {
    const id = this.ownerOfName(name);
    const account = id === null ? null : this.byId(id);
    if (!account) return null;
    return { name: account.name, joined: account.joined, games: account.games, wins: account.wins };
  }

  /** Renames an account; false when another account has the name. */
  rename(id: number, name: string): boolean {
    const owner = this.ownerOfName(name);
    if (owner !== null && owner !== id) return false;
    this.db
      .prepare("UPDATE accounts SET name = ?, name_key = ?, needs_name = 0 WHERE id = ?")
      .run(name, nameKey(name), id);
    return true;
  }

  setPassword(id: number, passwordHash: string, recoveryHash: string): void {
    this.db
      .prepare("UPDATE accounts SET password_hash = ?, recovery_hash = ? WHERE id = ?")
      .run(passwordHash, recoveryHash, id);
  }

  /** Each account played one counted game (D-037). */
  recordGame(ids: readonly number[]): void {
    const update = this.db.prepare("UPDATE accounts SET games = games + 1 WHERE id = ?");
    for (const id of ids) update.run(id);
  }

  /** Each account won a counted game. */
  recordWin(ids: readonly number[]): void {
    const update = this.db.prepare("UPDATE accounts SET wins = wins + 1 WHERE id = ?");
    for (const id of ids) update.run(id);
  }

  /** Erases the account and its sign-ins (D-037: at once, the name is free again). */
  deleteAccount(id: number): void {
    this.db.prepare("DELETE FROM sessions WHERE account_id = ?").run(id);
    this.db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  }

  get accountCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
  }

  // --- Sessions -------------------------------------------------------------------------

  addSession(keyHash: string, accountId: number, now: number): void {
    this.db
      .prepare("INSERT INTO sessions (key_hash, account_id, expires) VALUES (?, ?, ?)")
      .run(keyHash, accountId, now + SESSION_MS);
  }

  /**
   * The account a session belongs to, or null (unknown or expired). A session used more
   * than a day after it was last renewed gets the full 30 days again (`renewed`).
   */
  sessionAccount(keyHash: string, now: number): { account: Account; renewed: boolean } | null {
    const row = this.db
      .prepare("SELECT account_id, expires FROM sessions WHERE key_hash = ?")
      .get(keyHash) as { account_id: number; expires: number } | undefined;
    if (!row) return null;
    if (row.expires <= now) {
      this.removeSession(keyHash);
      return null;
    }
    const account = this.byId(row.account_id);
    if (!account) return null;
    const renewed = row.expires - now < SESSION_MS - SESSION_REFRESH_MS;
    if (renewed) {
      this.db
        .prepare("UPDATE sessions SET expires = ? WHERE key_hash = ?")
        .run(now + SESSION_MS, keyHash);
    }
    return { account, renewed };
  }

  removeSession(keyHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE key_hash = ?").run(keyHash);
  }

  /** Signs an account out everywhere (a new password from the recovery code). */
  removeSessions(accountId: number): void {
    this.db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
  }

  /** Forgets expired sessions (run now and then). */
  pruneSessions(now: number): void {
    this.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(now);
  }
}

function toAccount(raw: unknown): Account | null {
  const row = raw as AccountRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    needsName: row.needs_name === 1,
    joined: row.joined,
    games: row.games,
    wins: row.wins,
  };
}
