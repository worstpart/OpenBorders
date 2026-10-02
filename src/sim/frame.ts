/**
 * What one tick reports to the outside world (renderer, UI, tests, later the network).
 * Frames are self-contained copies: they never share memory with the live World, so a
 * host can post them across threads and a consumer can't corrupt the simulation.
 */
import type { SimEvent } from "./events.ts";
import { hashWorld } from "./stateHash.ts";
import type { Phase, PlayerId, PlayerKind, World } from "./world.ts";

export interface PlayerSnapshot {
  readonly id: PlayerId;
  readonly name: string;
  readonly kind: PlayerKind;
  readonly alive: boolean;
  readonly spawned: boolean;
  readonly ready: boolean;
  readonly tiles: number;
  readonly homeTroops: number;
  readonly fieldTroops: number;
  readonly capacity: number;
  readonly growthPerTick: number;
}

export interface TickFrame {
  readonly tick: number;
  readonly phase: Phase;
  readonly playStartTick: number;
  /** Tiles whose owner changed this tick, and each one's owner after the tick. */
  readonly changedTiles: Int32Array;
  readonly changedOwners: Uint16Array;
  readonly players: readonly PlayerSnapshot[];
  readonly events: readonly SimEvent[];
  readonly winner: PlayerId | null;
  /** Hash of the full game state after this tick. */
  readonly hash: number;
}

export function snapshotPlayers(world: World): PlayerSnapshot[] {
  return world.players.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    alive: p.alive,
    spawned: p.spawnTile >= 0,
    ready: p.ready,
    tiles: p.tiles,
    homeTroops: p.homeTroops,
    fieldTroops: p.fieldTroops,
    capacity: p.capacity,
    growthPerTick: p.lastGrowth,
  }));
}

export function buildFrame(world: World): TickFrame {
  const changedTiles = world.changes.toArray();
  const changedOwners = new Uint16Array(changedTiles.length);
  for (let k = 0; k < changedTiles.length; k++) changedOwners[k] = world.owner[changedTiles[k]!]!;
  return {
    tick: world.tick,
    phase: world.phase,
    playStartTick: world.playStartTick,
    changedTiles,
    changedOwners,
    players: snapshotPlayers(world),
    events: world.events.slice(),
    winner: world.winner,
    hash: hashWorld(world),
  };
}
