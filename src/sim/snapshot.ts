/**
 * World snapshots (Phase 3, milestone 3.0; D-006): the whole game state as plain JSON-safe
 * data, so a server can send it to a client that joins late, reconnects or has drifted, and
 * the client continues the game exactly — tick for tick, hash for hash.
 *
 * The encoding is generic: every field of the World and of everything inside it is saved,
 * except the static inputs (the map and the rules, which both sides already have) and the
 * per-tick output and scratch space listed in SKIPPED_WORLD_FIELDS. A field added to any
 * game object later is therefore saved without touching this file; a value of a kind it
 * doesn't know (a new class) makes serializeWorld throw instead of silently dropping it.
 *
 * Exactness: numbers keep their bit pattern (JSON round-trips doubles exactly; -0, NaN and
 * ±Infinity are tagged), Map and Set keep their iteration order (the systems iterate them),
 * TileQueues keep their heap layout and insertion counter, the RNG keeps its four words.
 */
import type { GameMap } from "./map/gameMap.ts";
import { Hasher } from "./math/hash.ts";
import { Rng, type RngState } from "./math/rng.ts";
import { DEFAULT_RULES, type GameRules } from "./rules.ts";
import { computeOwnerHash, hashWorld } from "./stateHash.ts";
import { TileQueue, type TileQueueState } from "./systems/tileQueue.ts";
import { createWorld, type Player, type PlayerSetup, type World } from "./world.ts";

/** Bumped whenever the encoding changes in a way older readers can't follow. */
export const SNAPSHOT_VERSION = 1;

/**
 * World fields not saved: the static inputs (supplied again by the receiver, checked by
 * fingerprint), the tick's output (cleared at the start of every tick) and scratch space.
 */
export const SKIPPED_WORLD_FIELDS: ReadonlySet<string> = new Set([
  "map",
  "rules",
  "changes",
  "fortChanges",
  "events",
  "scratchMarks",
  "scratchQueue",
]);

/** A value as it travels: JSON-safe (numbers, strings, booleans, null, arrays, objects). */
export type Encoded = number | string | boolean | null | Encoded[] | { [key: string]: Encoded };

export interface WorldSnapshot {
  readonly version: number;
  readonly tick: number;
  /** hashWorld at the moment it was taken; deserializeWorld checks the result against it. */
  readonly hash: number;
  /** Fingerprints of the map and the rules it belongs to (mapFingerprint, rulesFingerprint). */
  readonly mapKey: number;
  readonly rulesKey: number;
  /** Every saved World field, encoded. */
  readonly state: { readonly [field: string]: Encoded };
}

/** Saves the whole game state. Call it between ticks (never from inside a system). */
export function serializeWorld(world: World): WorldSnapshot {
  const state: { [field: string]: Encoded } = {};
  for (const [field, value] of Object.entries(world)) {
    if (!SKIPPED_WORLD_FIELDS.has(field)) state[field] = encode(value, field);
  }
  return {
    version: SNAPSHOT_VERSION,
    tick: world.tick,
    hash: hashWorld(world),
    mapKey: mapFingerprint(world.map),
    rulesKey: rulesFingerprint(world.rules),
    state,
  };
}

/**
 * Rebuilds a world from a snapshot, on the receiver's copy of the map and rules (a server and
 * its clients generate the map from the same seed). Throws if the map or rules differ from
 * the ones the snapshot was taken with, or if the rebuilt world's hash doesn't match.
 */
export function deserializeWorld(
  snapshot: WorldSnapshot,
  map: GameMap,
  rules: GameRules = DEFAULT_RULES,
): World {
  if (snapshot.version !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot version ${snapshot.version}, expected ${SNAPSHOT_VERSION}`);
  }
  if (mapFingerprint(map) !== snapshot.mapKey) throw new Error("snapshot is for another map");
  if (rulesFingerprint(rules) !== snapshot.rulesKey) {
    throw new Error("snapshot is for other rules");
  }
  const decoded: { [field: string]: unknown } = {};
  for (const [field, value] of Object.entries(snapshot.state)) decoded[field] = decode(value);
  const players = decoded["players"] as Player[] | undefined;
  if (!Array.isArray(players) || players.length < 1) throw new Error("snapshot has no players");

  // createWorld supplies the skipped fields (fresh output logs, scratch space) and the
  // per-map data it derives while loading; every saved field then replaces its value.
  const world = createWorld({ seed: 0, map, rules, players: players.map(setupOf) });
  const target = world as unknown as { [field: string]: unknown };
  for (const field of Object.keys(target)) {
    if (!SKIPPED_WORLD_FIELDS.has(field) && !(field in decoded)) {
      throw new Error(`snapshot is missing world.${field}`);
    }
  }
  for (const [field, value] of Object.entries(decoded)) {
    if (SKIPPED_WORLD_FIELDS.has(field)) continue;
    if (!(field in target)) throw new Error(`snapshot has an unknown field world.${field}`);
    target[field] = value;
  }
  if (world.owner.length !== map.width * map.height) throw new Error("snapshot owner size");
  if (computeOwnerHash(world.owner) !== world.ownerHash) {
    throw new Error("snapshot ownership doesn't match its ownership hash");
  }
  const hash = hashWorld(world);
  if (hash !== snapshot.hash) {
    throw new Error(`snapshot hash ${snapshot.hash} but the rebuilt world hashes to ${hash}`);
  }
  return world;
}

/** The setup that recreates a saved player (createWorld needs one per player). */
function setupOf(player: Player): PlayerSetup {
  const brain = player.brain;
  return {
    name: player.name,
    kind: player.kind,
    team: player.team,
    ...(brain
      ? { tier: brain.tier, personality: brain.personality, difficulty: brain.difficulty }
      : {}),
  };
}

/** Identifies a map by what the simulation reads from it (size and terrain, not relief). */
export function mapFingerprint(map: GameMap): number {
  const h = new Hasher().addInt(map.width).addInt(map.height).addInt(map.landTiles);
  const terrain = map.terrain;
  for (let i = 0; i < terrain.length; i++) h.addInt(terrain[i]!);
  return h.digest();
}

/** Identifies a rule set by its contents. */
export function rulesFingerprint(rules: GameRules): number {
  return new Hasher().addString(JSON.stringify(rules, numberReplacer)).digest();
}

// JSON writes NaN and ±Infinity as null; keep them apart in the fingerprint.
function numberReplacer(_key: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isFinite(value) ? String(value) : value;
}

// ---------------------------------------------------------------------------------------
// Encoding. Plain objects keep their keys; everything else is an object with one "$" key:
//   {$n: "-0" | "NaN" | "Infinity" | "-Infinity"}   a number JSON can't carry
//   {$u: 0}                                           undefined (an optional field set to it)
//   {$map: [[key, value], …]}  {$set: [value, …]}    in iteration order
//   {$ta: kind, v: [values]} or {$ta: kind, rle: [value, count, …]}   a typed array
//   {$tq: TileQueueState}  {$rng: RngState}
// ---------------------------------------------------------------------------------------

type TypedArrayKind = "u8" | "u16" | "i32" | "f64";

function typedArrayKind(value: unknown): TypedArrayKind | null {
  if (value instanceof Uint8Array) return "u8";
  if (value instanceof Uint16Array) return "u16";
  if (value instanceof Int32Array) return "i32";
  if (value instanceof Float64Array) return "f64";
  return null;
}

function encodeNumber(value: number): Encoded {
  if (Number.isFinite(value) && !Object.is(value, -0)) return value;
  return { $n: Object.is(value, -0) ? "-0" : String(value) };
}

function decodeNumber(text: string): number {
  switch (text) {
    case "-0":
      return -0;
    case "NaN":
      return NaN;
    case "Infinity":
      return Infinity;
    case "-Infinity":
      return -Infinity;
    default:
      throw new Error(`snapshot: bad number tag ${text}`);
  }
}

function encode(value: unknown, path: string): Encoded {
  if (value === null) return null;
  switch (typeof value) {
    case "number":
      return encodeNumber(value);
    case "string":
    case "boolean":
      return value;
    case "undefined":
      return { $u: 0 };
    case "object":
      break;
    default:
      throw new Error(`snapshot: can't encode a ${typeof value} at ${path}`);
  }
  if (Array.isArray(value)) return value.map((item, i) => encode(item, `${path}[${i}]`));
  const kind = typedArrayKind(value);
  if (kind) return encodeTypedArray(kind, value as ArrayLike<number>);
  if (value instanceof Map) {
    const entries: Encoded[] = [];
    for (const [k, v] of value)
      entries.push([encode(k, `${path}.key`), encode(v, `${path}.value`)]);
    return { $map: entries };
  }
  if (value instanceof Set) {
    const items: Encoded[] = [];
    for (const item of value) items.push(encode(item, `${path}.item`));
    return { $set: items };
  }
  if (value instanceof TileQueue) {
    const state = value.save();
    return {
      $tq: {
        times: state.times.map(encodeNumber),
        tiles: [...state.tiles],
        order: [...state.order],
        inserted: state.inserted,
      },
    };
  }
  if (value instanceof Rng) return { $rng: [...value.getState()] };
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const name = (value as { constructor?: { name?: string } }).constructor?.name ?? "?";
    throw new Error(`snapshot: can't encode a ${name} at ${path} — teach snapshot.ts about it`);
  }
  const out: { [key: string]: Encoded } = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith("$")) throw new Error(`snapshot: field names can't start with $ (${path})`);
    out[key] = encode(item, `${path}.${key}`);
  }
  return out;
}

function encodeTypedArray(kind: TypedArrayKind, array: ArrayLike<number>): Encoded {
  const n = array.length;
  let runs = 0;
  for (let i = 0; i < n; i++) if (i === 0 || !Object.is(array[i], array[i - 1])) runs++;
  if (runs * 2 < n) {
    const rle: Encoded[] = [];
    let i = 0;
    while (i < n) {
      const v = array[i]!;
      let j = i + 1;
      while (j < n && Object.is(array[j], v)) j++;
      rle.push(encodeNumber(v), j - i);
      i = j;
    }
    return { $ta: kind, rle };
  }
  const v: Encoded[] = new Array<Encoded>(n);
  for (let i = 0; i < n; i++) v[i] = encodeNumber(array[i]!);
  return { $ta: kind, v };
}

function decode(value: Encoded): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decode);
  if ("$n" in value) return decodeNumber(value["$n"] as string);
  if ("$u" in value) return undefined;
  if ("$map" in value) {
    const map = new Map<unknown, unknown>();
    for (const entry of value["$map"] as Encoded[][]) map.set(decode(entry[0]!), decode(entry[1]!));
    return map;
  }
  if ("$set" in value) return new Set((value["$set"] as Encoded[]).map(decode));
  if ("$ta" in value) return decodeTypedArray(value);
  if ("$tq" in value) {
    const q = value["$tq"] as { [key: string]: Encoded };
    const state: TileQueueState = {
      times: (q["times"] as Encoded[]).map((t) => decode(t) as number),
      tiles: q["tiles"] as number[],
      order: q["order"] as number[],
      inserted: q["inserted"] as number,
    };
    return TileQueue.restore(state);
  }
  if ("$rng" in value) return Rng.fromState(value["$rng"] as unknown as RngState);
  const out: { [key: string]: unknown } = {};
  for (const [key, item] of Object.entries(value)) out[key] = decode(item);
  return out;
}

function newTypedArray(
  kind: TypedArrayKind,
  length: number,
): Uint8Array | Uint16Array | Int32Array | Float64Array {
  switch (kind) {
    case "u8":
      return new Uint8Array(length);
    case "u16":
      return new Uint16Array(length);
    case "i32":
      return new Int32Array(length);
    case "f64":
      return new Float64Array(length);
    default:
      throw new Error(`snapshot: unknown typed array kind ${String(kind)}`);
  }
}

function decodeTypedArray(value: { [key: string]: Encoded }): unknown {
  const kind = value["$ta"] as TypedArrayKind;
  if ("rle" in value) {
    const rle = value["rle"] as Encoded[];
    let length = 0;
    for (let i = 1; i < rle.length; i += 2) length += rle[i] as number;
    const array = newTypedArray(kind, length);
    let at = 0;
    for (let i = 0; i < rle.length; i += 2) {
      const count = rle[i + 1] as number;
      array.fill(decode(rle[i]!) as number, at, at + count);
      at += count;
    }
    return array;
  }
  const items = value["v"] as Encoded[];
  const array = newTypedArray(kind, items.length);
  for (let i = 0; i < items.length; i++) array[i] = decode(items[i]!) as number;
  return array;
}
