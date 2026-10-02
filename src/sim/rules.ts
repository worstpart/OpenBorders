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

/** A value per land terrain type. */
export interface PerTerrain {
  readonly plains: number;
  readonly highland: number;
  readonly mountain: number;
}

/**
 * How fronts move (GAME_DESIGN.md §3.5–3.7). An attack doesn't have a per-tick "budget":
 * every tile next to the front gets a ready time, and the attack takes it once that
 * time has come and it can pay the troop cost. A front therefore advances one tile per
 * "layer delay", whatever the size of the border, and wide borders capture more tiles
 * per tick simply because more tiles are on the front.
 */
export interface ExpansionRules {
  /** Troops spent per neutral tile taken. */
  readonly costPerTile: PerTerrain;
  /** Ticks for the front to advance one tile into neutral plains with a full-speed army. */
  readonly layerDelayTicks: number;
  /** Delay multiplier per terrain (mountains are slower). */
  readonly terrainDelay: PerTerrain;
  /** Armies at least this big expand at full speed; smaller ones crawl proportionally. */
  readonly fullSpeedArmy: number;
  /** Speed floor for tiny armies (share of full speed). */
  readonly minSpeedShare: number;
}

export interface CombatRules {
  /** Attacker loss multiplier per terrain. */
  readonly terrainLoss: PerTerrain;
  /** Delay multiplier per terrain. */
  readonly terrainDelay: PerTerrain;
  /** Loss per tile that doesn't depend on the defender (moving and holding land). */
  readonly lossBase: number;
  /** Extra loss per unit of defender density (defender home troops per tile). */
  readonly lossDensity: number;
  /** Bounds on the outnumbering ratio r = defender home ÷ attacking army, for losses. */
  readonly lossRatioMin: number;
  readonly lossRatioMax: number;
  /** Ticks per tile of advance at r = 1 on plains. */
  readonly layerDelayTicks: number;
  /** Bounds on r for speed: overwhelming attacks are a bit faster, outnumbered ones slow. */
  readonly delayRatioMin: number;
  readonly delayRatioMax: number;
  /** Above this r, attacks slow down further in proportion (hopeless attacks barely move). */
  readonly hopelessRatio: number;
}

export interface AttackRules {
  /**
   * Directed attacks (D-010). Border tiles start this many ticks later per tile of
   * distance from the one nearest the click: the attack opens near the click point and
   * then widens along the border. 0 = the whole shared border starts at once.
   */
  readonly focusSpread: number;
  /**
   * Steps toward the click point are faster than steps away from it: a step moving
   * directly away takes (1 + focusPull)× as long. 0 = no pull.
   */
  readonly focusPull: number;
  /**
   * Each extra side of a front tile the attacker owns cuts its remaining wait by this
   * share of a layer delay. 0.29 (= 1 − 1/√2) makes diagonal fronts advance as fast as
   * straight ones, so fronts grow round instead of diamond-shaped; gaps fill quickly.
   */
  readonly fillShare: number;
  /** Random extra delay (0..this) per tile, so fronts look organic. */
  readonly noiseTicks: number;
  /** A retreating army comes home after this many ticks. */
  readonly retreatTicks: number;
  /** Share of a retreating army lost when retreating from a player (none from neutral land). */
  readonly retreatPenalty: number;
}

export interface GameRules {
  /** Simulation tick length. 10 ticks per second (D-004). */
  readonly tickMs: number;
  readonly troops: TroopRules;
  readonly spawn: SpawnRules;
  readonly expansion: ExpansionRules;
  readonly combat: CombatRules;
  readonly attack: AttackRules;
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
  expansion: {
    // Cheap enough that early growth outpaces expansion (a race limited by speed and
    // geography); costly enough that big frontiers later make direction a real choice.
    costPerTile: { plains: 3, highland: 4, mountain: 6 },
    // ~2.5 tiles/s on open plains (with noise); terrain, direction and army size slow it.
    // On the reference map the land race with 8 players should last about a minute
    // (GAME_DESIGN.md §3.2) — to be confirmed by headless games in milestone 1.7.
    layerDelayTicks: 3,
    terrainDelay: { plains: 1, highland: 1.25, mountain: 1.67 },
    fullSpeedArmy: 2_000,
    minSpeedShare: 0.1,
  },
  combat: {
    // Mountains: ~1.5× losses and ~1.5× slower than plains.
    terrainLoss: { plains: 1, highland: 1.25, mountain: 1.5 },
    terrainDelay: { plains: 1, highland: 1.25, mountain: 1.5 },
    // At r = 1 against density d, a tile costs 3 + 1.2·d while the defender loses d.
    // Because the cost scales with r (= D/A), a fight follows Lanchester's square law:
    // an army A takes everything from a home pool D when A² > 1.2·D², i.e. with ~10% more
    // troops. Equal armies stall (the defender keeps ~40%), so attacking needs an edge,
    // and sending twice the defender's pool (r = 0.5) halves the cost per tile.
    lossBase: 3,
    lossDensity: 1.2,
    lossRatioMin: 0.5,
    lossRatioMax: 2.5,
    // ~2.5 tiles/s at even odds: fights move about as fast as expansion.
    layerDelayTicks: 4,
    delayRatioMin: 0.8,
    delayRatioMax: 8,
    hopelessRatio: 20,
  },
  attack: {
    // The attack widens along the border at ~3 tiles per tick from the point nearest
    // the click; noticeable on long borders, irrelevant on short ones.
    focusSpread: 0.35,
    // A step straight away from the click point takes twice as long as one toward it.
    focusPull: 1,
    fillShare: 0.29,
    noiseTicks: 1.5,
    retreatTicks: 20,
    retreatPenalty: 0.2,
  },
});

/** A copy of the default rules with some values overridden (tests, tuning experiments). */
export function makeRules(overrides: {
  troops?: Partial<TroopRules>;
  spawn?: Partial<SpawnRules>;
  expansion?: Partial<ExpansionRules>;
  combat?: Partial<CombatRules>;
  attack?: Partial<AttackRules>;
}): GameRules {
  return deepFreeze({
    ...DEFAULT_RULES,
    troops: { ...DEFAULT_RULES.troops, ...overrides.troops },
    spawn: { ...DEFAULT_RULES.spawn, ...overrides.spawn },
    expansion: { ...DEFAULT_RULES.expansion, ...overrides.expansion },
    combat: { ...DEFAULT_RULES.combat, ...overrides.combat },
    attack: { ...DEFAULT_RULES.attack, ...overrides.attack },
  });
}

/** Looks up a per-terrain value (water has none and must never be asked for). */
export function terrainValue(table: PerTerrain, terrain: number): number {
  switch (terrain) {
    case 1:
      return table.plains;
    case 2:
      return table.highland;
    case 3:
      return table.mountain;
    default:
      throw new Error(`no terrain value for terrain ${terrain}`);
  }
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) deepFreeze(child);
  }
  return Object.freeze(value);
}
