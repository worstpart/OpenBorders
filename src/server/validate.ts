/**
 * What the server lets through to the simulation (milestone 3.3, D-006). The simulation
 * already judges every command's *meaning* when it runs it (your tile? enough gold? in
 * range?) and turns bad ones into `commandRejected` events. This file judges the *shape*
 * first, so nothing a client sends can be something the simulation was never written to
 * read: every command type has an exact list of fields, each with its kind and range, and
 * anything else — an unknown type, a missing or extra field, a string where a number goes,
 * a huge number, a 10,000-point wall — is refused before it reaches a turn.
 *
 * Also here: how fast a player may send (CommandBudget) — commands beyond the budget are
 * dropped, and a connection that keeps flooding or keeps sending malformed commands is
 * closed (the player's country stays and stops acting, D-036).
 */
import type { Command } from "../sim/commands.ts";
import { BUILDING_TYPES, PING_KINDS } from "../sim/rules.ts";

export type Field =
  /** An integer in [min, max]. */
  | { readonly int: readonly [number, number] }
  | { readonly bool: true }
  | { readonly oneOf: readonly string[] }
  /** A list of integers in [min, max], between minLength and maxLength of them. */
  | { readonly ints: readonly [number, number]; readonly length: readonly [number, number] };

/** Tiles: maps are at most 16M tiles (createMap); -1 where a command allows "none". */
const TILE: Field = { int: [0, 0xffffff] };
const PLAYER: Field = { int: [0, 0xffff] };
const ID: Field = { int: [0, 0x7fffffff] };
const PERCENT: Field = { int: [0, 10_000] };

type OnlineCommandType = Exclude<Command["type"], "testFlight">;

/** Every online command's fields. A command type missing here is a compile error. */
export const COMMAND_SCHEMAS: {
  readonly [T in OnlineCommandType]: { readonly [field: string]: Field };
} = {
  spawn: { tile: TILE },
  confirmSpawn: {},
  attack: { target: PLAYER, focusTile: TILE, percentBp: PERCENT },
  boat: { target: PLAYER, tile: TILE, percentBp: PERCENT },
  recallBoat: { boatId: ID },
  retreat: { attackId: ID },
  allianceRequest: { target: PLAYER },
  allianceReply: { from: PLAYER, accept: { bool: true } },
  allianceRenew: { ally: PLAYER },
  allianceBreak: { ally: PLAYER },
  donate: { to: PLAYER, resource: { oneOf: ["troops", "gold"] }, percentBp: PERCENT },
  build: { buildingType: { oneOf: BUILDING_TYPES }, tile: TILE },
  upgrade: { buildingId: ID },
  cancelBuild: { buildingId: ID },
  buildWall: { points: { ints: [0, 0xffffff], length: [2, 32] } },
  upgradeWall: { wallId: ID },
  cancelWall: { wallId: ID },
  emote: { to: PLAYER, emoji: { int: [0, 255] } },
  airlift: { buildingId: ID, tile: TILE, percentBp: PERCENT },
  assault: { buildingId: ID, tile: TILE, percentBp: PERCENT },
  airStrike: { buildingId: ID, tile: TILE },
  launchMissile: {
    buildingId: ID,
    tile: TILE,
    missile: { oneOf: ["missile", "buster", "warhead"] },
  },
  moveWarship: { warshipId: ID, tile: { int: [-1, 0xffffff] } },
  ping: { tile: TILE, kind: { oneOf: PING_KINDS } },
};

/** Why `value` is not an acceptable online command, or null when it is one. */
export function commandProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not a command";
  const record = value as Record<string, unknown>;
  const type = record["type"];
  if (typeof type !== "string" || !Object.hasOwn(COMMAND_SCHEMAS, type)) return "unknown command";
  const schema = COMMAND_SCHEMAS[type as OnlineCommandType];
  for (const key of Object.keys(record)) {
    if (key !== "type" && !Object.hasOwn(schema, key)) return `unexpected field ${key}`;
  }
  for (const [key, field] of Object.entries(schema)) {
    if (!fieldFits(record[key], field)) return `bad ${key}`;
  }
  return null;
}

function isIntIn(value: unknown, [min, max]: readonly [number, number]): boolean {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function fieldFits(value: unknown, field: Field): boolean {
  if ("int" in field) return isIntIn(value, field.int);
  if ("bool" in field) return typeof value === "boolean";
  if ("oneOf" in field) return typeof value === "string" && field.oneOf.includes(value);
  return (
    Array.isArray(value) &&
    value.length >= field.length[0] &&
    value.length <= field.length[1] &&
    value.every((n) => isIntIn(n, field.ints))
  );
}

/** How fast one player may act (milestone 3.3). Generous for a human, useless for a flood. */
export const COMMAND_LIMITS = {
  /** Commands (and lobby actions) a player may send at once… */
  burst: 30,
  /** …refilled at this many per second. */
  perSecond: 15,
  /** Commands dropped for going over the budget before the connection is closed. */
  maxDropped: 60,
  /** Malformed commands before the connection is closed (a real client sends none). */
  maxMalformed: 20,
} as const;

export type Verdict = "ok" | "drop" | "kick";

/** One player's sending budget (a token bucket) and their misbehaviour so far. */
export class CommandBudget {
  private tokens: number = COMMAND_LIMITS.burst;
  private last: number;
  private dropped = 0;
  private malformed = 0;
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
    this.last = now();
  }

  /** May this player send one more message now? */
  take(): Verdict {
    const now = this.now();
    this.tokens = Math.min(
      COMMAND_LIMITS.burst,
      this.tokens + ((now - this.last) / 1000) * COMMAND_LIMITS.perSecond,
    );
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return "ok";
    }
    this.dropped++;
    return this.dropped > COMMAND_LIMITS.maxDropped ? "kick" : "drop";
  }

  /** The player sent something that isn't a command. */
  strike(): Verdict {
    this.malformed++;
    return this.malformed > COMMAND_LIMITS.maxMalformed ? "kick" : "drop";
  }
}
