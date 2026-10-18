/**
 * Secrets for accounts (3.7, D-037), with Node's own crypto — no package:
 *
 * - Passwords go through scrypt with a random salt per account. The cost (N = 2^15, r = 8,
 *   p = 3: 32 MB and a few tenths of a second) is one of OWASP's recommended scrypt settings;
 *   it is stored with each hash, so it can be raised later without breaking old passwords.
 * - Session keys and recovery codes are long random values, so a plain SHA-256 of them is
 *   enough to store (nobody can guess 128 random bits, slow hashing adds nothing).
 */
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const COST = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, cost: ScryptOptions): Promise<Buffer> {
  // scrypt needs 128 · N · r bytes; Node's default limit (32 MB) is just too small.
  const maxmem = 256 * cost.N! * cost.r!;
  return new Promise((done, fail) =>
    scrypt(password.normalize("NFC"), salt, KEY_BYTES, { ...cost, maxmem }, (error, key) =>
      error ? fail(error) : done(key),
    ),
  );
}

/** "scrypt$N$r$p$salt$hash" (base64url), for the database. Runs off the main thread. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST);
  return [
    "scrypt",
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** Whether `password` matches a stored hash (in constant time). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * A password that matches no account's: checked against when the name is unknown, so a
 * wrong name takes as long as a wrong password (names can't be probed by timing).
 */
export const DUMMY_HASH_PROMISE = hashPassword(randomBytes(12).toString("base64url"));

/** A secret for a session cookie: 32 random bytes. */
export function newSessionKey(): string {
  return randomBytes(32).toString("base64url");
}

/** Letters that can't be mixed up when copied by hand (no 0/O, 1/I/L). */
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A recovery code: 4 groups of 5 letters (about 99 random bits), e.g. "K7QXM-…". */
export function newRecoveryCode(): string {
  const bytes = randomBytes(20);
  let code = "";
  for (let k = 0; k < 20; k++) {
    if (k > 0 && k % 5 === 0) code += "-";
    // 31 letters: 256 isn't a multiple, but the bias (< 1%) costs well under a bit.
    code += CODE_LETTERS[bytes[k]! % CODE_LETTERS.length];
  }
  return code;
}

/** A recovery code as typed: capitals, no spaces or dashes. */
export function normalizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** SHA-256 in base64url: how session keys and recovery codes are stored. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
