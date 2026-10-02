/**
 * GameRules: every tunable gameplay number, in one place, with the reason for its value
 * (GAME_DESIGN.md §3). Systems never hard-code these. Values are starting points to be
 * tuned by playtests and headless bot games; golden tests pin the resulting formulas
 * so any balance change is deliberate.
 */

export interface TroopRules {
  /** Capacity at 0 tiles. Gives a usable army right after spawning. */
  readonly capacityBase: number;
  /** Capacity gained per tiles^capacityExponent. */
  readonly capacityScale: number;
  /** Sublinear: doubling land gives ~1.5× capacity, so land matters but snowballing is damped. */
  readonly capacityExponent: number;
  /** Growth per tick at 0 troops: a player with almost nothing still recovers. */
  readonly growthFloor: number;
  /** Scales the peak growth (reached at 50% of capacity). */
  readonly growthScale: number;
  /** Peak growth ∝ capacity^0.75: big empires refill proportionally slower. */
  readonly growthExponent: number;
  /** Share of capacity a player starts with after spawning. */
  readonly startShare: number;
}

export interface SpawnRules {
  /** Spawn claims land within this radius (tiles) of the chosen tile: radius 4 ≈ 49 tiles. */
  readonly radius: number;
  /** No player-vs-player attacks for this many ticks after the match starts (5 s). */
  readonly protectionTicks: number;
  /** Preferred minimum distance (tiles) between random spawns; relaxed if the map is crowded. */
  readonly randomMinDistance: number;
  /** A random spawn needs at least this share of its disc to be claimable land (no slivers). */
  readonly randomMinLandShare: number;
}

export interface GameRules {
  /** Simulation tick length. 10 ticks per second (D-004). */
  readonly tickMs: number;
  readonly troops: TroopRules;
  readonly spawn: SpawnRules;
}

export const DEFAULT_RULES: GameRules = deepFreeze({
  tickMs: 100,
  troops: {
    capacityBase: 10_000,
    capacityScale: 1_000,
    capacityExponent: 0.6,
    growthFloor: 10,
    // Early game: ~15 s from 10% to 50% of capacity and ~15 s from 50% to 90%.
    growthScale: 0.044,
    growthExponent: 0.75,
    startShare: 0.3,
  },
  spawn: {
    radius: 4,
    protectionTicks: 50,
    // On the ~1100×700 reference map each of 8 players has ~50k land tiles (radius ~125),
    // so 70 keeps random spawns apart without failing on crowded maps.
    randomMinDistance: 70,
    randomMinLandShare: 0.8,
  },
});

/** A copy of the default rules with some values overridden (tests, tuning experiments). */
export function makeRules(overrides: {
  troops?: Partial<TroopRules>;
  spawn?: Partial<SpawnRules>;
}): GameRules {
  return deepFreeze({
    ...DEFAULT_RULES,
    troops: { ...DEFAULT_RULES.troops, ...overrides.troops },
    spawn: { ...DEFAULT_RULES.spawn, ...overrides.spawn },
  });
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) deepFreeze(child);
  }
  return Object.freeze(value);
}
