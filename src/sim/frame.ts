/**
 * What one tick reports to the outside world (renderer, UI, tests, later the network).
 * Frames are self-contained copies: they never share memory with the live World, so a
 * host can post them across threads and a consumer can't corrupt the simulation.
 */
import type { SimEvent } from "./events.ts";
import { hashWorld } from "./stateHash.ts";
import { landNeighbors } from "./systems/attacks.ts";
import type { Difficulty } from "./rules.ts";
import type { BotTier, Phase, PlayerId, PlayerKind, World } from "./world.ts";

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
  readonly peakTiles: number;
  /** Bots only: nation or tribe (GAME_DESIGN.md §3.13). */
  readonly tier: BotTier | null;
  /** Nations only. */
  readonly personality: string | null;
  /** Nations only. */
  readonly difficulty: Difficulty | null;
  /** Tick the player was eliminated, or -1. */
  readonly eliminatedTick: number;
  /** A traitor until this tick (compare with the frame's tick); -1 = never. */
  readonly traitorUntilTick: number;
  /** Alliances this player has broken. */
  readonly betrayals: number;
  /** Team number, or 0 = no team (GAME_DESIGN.md §3.15). */
  readonly team: number;
  /**
   * Whose land touches this player's (0 = neutral), ascending — what a click can reach.
   * Humans only (the HUD needs it); null for bots, to save the work every tick.
   */
  readonly neighbors: readonly PlayerId[] | null;
}

export interface AttackSnapshot {
  readonly id: number;
  readonly attacker: PlayerId;
  /** 0 = expanding into neutral land. */
  readonly target: PlayerId;
  readonly troops: number;
  readonly tilesTaken: number;
  readonly focusTile: number;
  readonly retreating: boolean;
}

export interface AllianceSnapshot {
  /** The lower player id and the higher one. */
  readonly a: PlayerId;
  readonly b: PlayerId;
  readonly expiresTick: number;
  /** Who has agreed to renew during the renewal window. */
  readonly renewA: boolean;
  readonly renewB: boolean;
}

export interface AllianceRequestSnapshot {
  readonly from: PlayerId;
  readonly to: PlayerId;
  readonly expiresTick: number;
}

export interface TickFrame {
  readonly tick: number;
  readonly phase: Phase;
  readonly playStartTick: number;
  /** Tiles whose owner changed this tick, and each one's owner after the tick. */
  readonly changedTiles: Int32Array;
  readonly changedOwners: Uint16Array;
  readonly players: readonly PlayerSnapshot[];
  readonly attacks: readonly AttackSnapshot[];
  readonly alliances: readonly AllianceSnapshot[];
  readonly allianceRequests: readonly AllianceRequestSnapshot[];
  readonly events: readonly SimEvent[];
  readonly winner: PlayerId | null;
  /** Team games: the team that won (0 = none). */
  readonly winningTeam: number;
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
    peakTiles: p.peakTiles,
    tier: p.brain?.tier ?? null,
    personality: p.brain?.tier === "nation" ? p.brain.personality : null,
    difficulty: p.brain?.tier === "nation" ? p.brain.difficulty : null,
    eliminatedTick: p.eliminatedTick,
    traitorUntilTick: p.traitorUntilTick,
    betrayals: p.betrayals,
    team: p.team,
    neighbors: p.kind === "human" && p.alive ? landNeighbors(world, p) : null,
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
    attacks: world.attacks.map((a) => ({
      id: a.id,
      attacker: a.attacker,
      target: a.target,
      troops: a.troops,
      tilesTaken: a.tilesTaken,
      focusTile: a.focusTile,
      retreating: a.retreatTick >= 0,
    })),
    alliances: [...world.alliances.values()].map((a) => ({
      a: a.a,
      b: a.b,
      expiresTick: a.expiresTick,
      renewA: a.renewA,
      renewB: a.renewB,
    })),
    allianceRequests: world.allianceRequests.map((r) => ({ ...r })),
    events: world.events.slice(),
    winner: world.winner,
    winningTeam: world.winningTeam,
    hash: hashWorld(world),
  };
}
