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
  /**
   * In crowded lobbies the preferred distance shrinks to this share of the spacing an
   * even spread would give (√(land tiles ÷ players)), so random spawns are spread evenly
   * from the first to the last instead of the first ones taking the room.
   */
  readonly randomSpacingShare: number;
  /** Tribes only keep this far from each other (their discs just don't overlap)… */
  readonly tribeMinDistance: number;
  /** …and this far from nations and humans. */
  readonly tribeRivalDistance: number;
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
  /**
   * Crush curve: below r = 1 the delay is r^crushExponent, so the front speeds up faster
   * than the advantage grows — a much bigger army floods a small player.
   */
  readonly crushExponent: number;
  /**
   * Bounds on the delay factor. Outnumbered attacks (r > 1) slow down in proportion,
   * up to 8×.
   */
  readonly delayRatioMin: number;
  readonly delayRatioMax: number;
  /** Above this r, attacks slow down further in proportion (hopeless attacks barely move). */
  readonly hopelessRatio: number;
}

export interface GrowthRules {
  /** Vein spacing: noise frequency in 1/tiles (0.06 ≈ a vein every ~15 tiles). */
  readonly veinScale: number;
  /** How thin the veins are (higher = thinner, more stringy). */
  readonly veinSharpness: number;
  /** Delay multiplier on a vein (fast)… */
  readonly onVein: number;
  /** …and far from any vein (slow). The mix keeps the average speed about the same. */
  readonly offVein: number;
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
   * How a front tile's wait depends on how many of its sides the attacker already owns.
   * Positive: each extra side cuts the wait by this share of a layer delay (0.29 makes
   * fronts perfectly round). Negative: tiles wedged into the attacker's land wait longer,
   * so the tips of the front grow fastest — organic, lobed, finger-like fronts.
   */
  readonly fillShare: number;
  /**
   * Random extra delay per tile, as a share of its delay (0..this), so fronts look
   * organic. A share, not a fixed time: terrain keeps its full effect on fast fronts.
   */
  readonly noiseShare: number;
  /**
   * Organic, virus-like spread: every attack follows its own random network of thin,
   * branching veins (ridged noise). On a vein the front races ahead; between veins it
   * creeps — so territory reaches out in tendrils and fills in behind them.
   */
  readonly growth: GrowthRules;
  /** A retreating army comes home after this many ticks. */
  readonly retreatTicks: number;
  /** Share of a retreating army lost when retreating from a player (none from neutral land). */
  readonly retreatPenalty: number;
}

/** Encirclement (GAME_DESIGN.md §3.8): fully enclosed land falls to the encloser. */
export interface EncirclementRules {
  /** Each player is checked this often (staggered by player id). */
  readonly intervalTicks: number;
  /**
   * A player's main territory falls to a single encloser only while that encloser attacks
   * them with an army of at least this many times their home troops — a real assault
   * they'd lose anyway, not a token attack.
   */
  readonly mainTerritoryArmyShare: number;
}

/** Elimination (GAME_DESIGN.md §3.9). */
export interface EliminationRules {
  /** A player under attack below this many tiles is absorbed by the attacker... */
  readonly absorbBelowTiles: number;
  /** ...if they also hold at most this share of their peak territory (no spawn rushes). */
  readonly absorbBelowPeakShare: number;
}

/** Victory (GAME_DESIGN.md §3.10). */
export interface VictoryRules {
  /** Share of all land that wins the game outright… */
  readonly landShare: number;
  /** …until this many ticks of play; then it drops by `declineStep`… */
  readonly declineStartTicks: number;
  /** …every this many ticks… */
  readonly declineStepTicks: number;
  readonly declineStep: number;
  /** …down to this share. */
  readonly minLandShare: number;
}

/**
 * Alliances (GAME_DESIGN.md §3.14): timed, renewable, with a price for betrayal.
 */
export interface DiplomacyRules {
  /** false: no alliances at all (lobbies play exactly as before milestone 2.2). */
  readonly enabled: boolean;
  /** A request is answered within this many ticks or it expires. */
  readonly requestTicks: number;
  /** A player may ask the same player again this many ticks after their last request. */
  readonly requestCooldownTicks: number;
  /** An alliance lasts this long (and each renewal adds as much). */
  readonly durationTicks: number;
  /** Both allies are asked to renew during the last this-many ticks. */
  readonly renewWindowTicks: number;
  /** Breaking an alliance marks the breaker a traitor for this long… */
  readonly traitorTicks: number;
  /** …during which anyone attacking them pays this share of the normal losses per tile… */
  readonly traitorLoss: number;
  /** …and waits this share of the normal delay per tile (moves faster). */
  readonly traitorDelay: number;
}

/**
 * Gold (GAME_DESIGN.md §3.16): earned from land, spent on Mobilize (instant troops), given
 * to friends. Model E2 of §6.1.
 */
export interface EconomyRules {
  /** false: no gold at all (games play exactly as before milestone 2.4). */
  readonly enabled: boolean;
  /** Gold per tick of play: incomeBase + incomePerSqrtTile · √tiles, rounded down. */
  readonly incomeBase: number;
  readonly incomePerSqrtTile: number;
  /** Tribes earn this share of the income (and never spend it: it becomes loot). */
  readonly tribeIncomeShare: number;
  /** Mobilize: gold per troop raised. */
  readonly goldPerTroop: number;
  /** Whoever eliminates a player takes this share of their gold. */
  readonly lootShare: number;
  /** Each kind of donation (troops, gold) to the same friend at most this often. */
  readonly donationCooldownTicks: number;
}

/**
 * Building types built so far (GAME_DESIGN.md §3.17). Border Defense (2.6), Port (2.7) and
 * the air/strategic buildings (Phase 2B) join this list in their own milestones.
 */
export const BUILDING_TYPES = ["housing", "factory"] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

/**
 * One level of a building. Effect numbers are the building's total at that level (not
 * the step from the level below), so "Housing II: +80k capacity" reads straight off it.
 */
export interface BuildingLevelRules {
  /** Display name of the level ("Developed Housing"). */
  readonly name: string;
  /** Gold to build it (level 1) or to upgrade to it, before escalation. */
  readonly cost: number;
  /** Ticks the construction or upgrade takes. */
  readonly buildTicks: number;
  /** Extra troop capacity. */
  readonly capacity?: number;
  /** Extra troop growth (share; all of a player's buildings together are capped). */
  readonly growthBonus?: number;
  /** Extra gold per tick. */
  readonly income?: number;
  /** Mobilize costs this share less (the player's best building counts; no stacking). */
  readonly mobilizeDiscount?: number;
}

export interface BuildingTypeRules {
  /** Levels I, II, III. */
  readonly levels: readonly [BuildingLevelRules, BuildingLevelRules, BuildingLevelRules];
  /** When its tile is captured: drop a level (L1 → destroyed), or be destroyed outright. */
  readonly onCapture: "downgrade" | "destroy";
}

/** Buildings (GAME_DESIGN.md §3.17): three levels each, paid in gold. */
export interface BuildingRules {
  /** false: nobody can build (games play exactly as in 2.4). Needs the economy. */
  readonly enabled: boolean;
  /** Buildings stand at least this far apart (tiles, straight line), whoever owns them. */
  readonly minSpacing: number;
  /** Each level a player already owns of a type makes the next build/upgrade of it this much dearer… */
  readonly escalationPerLevel: number;
  /** …up to this multiple of the base price. */
  readonly escalationMax: number;
  /** Prices are rounded to this many gold (readable numbers on the HUD). */
  readonly priceRounding: number;
  /** Cancelling a construction or upgrade refunds this share of what it cost. */
  readonly cancelRefund: number;
  /** All growth bonuses of a player's buildings together are capped at this share. */
  readonly maxGrowthBonus: number;
  readonly types: Readonly<Record<BuildingType, BuildingTypeRules>>;
}

/** How nations build (GAME_DESIGN.md §3.17, ai/build.ts). Tribes never build. */
export interface BuildAiRules {
  /**
   * A nation saves toward its best building option if it costs at most this many ticks of
   * its income (so it aims at what it can reach soon)…
   */
  readonly goalHorizonTicks: number;
  /**
   * …keeping this share of the price out of its war chest (Mobilize before attacks), by
   * personality: turtles invest, aggressors fight.
   */
  readonly saving: Readonly<Record<Personality, number>>;
  /** At most one building per this many tiles; beyond that it only upgrades. */
  readonly tilesPerBuilding: number;
  /**
   * How a nation values an option (troop-equivalents per unit): gold per tick counts for
   * this many ticks of income…
   */
  readonly incomeHorizonTicks: number;
  /** …and a growth bonus for this many ticks of peak growth. */
  readonly growthHorizonTicks: number;
  /** Candidate tiles sampled per placement. */
  readonly placementSamples: number;
}

export const PERSONALITIES = ["expander", "aggressor", "turtle", "opportunist"] as const;
export type Personality = (typeof PERSONALITIES)[number];

/** How one kind of bot plays (GAME_DESIGN.md §3.11). Shares are of capacity or home troops. */
export interface PersonalityRules {
  /** Expand into neutral land once home troops reach this share of capacity. */
  readonly expandAt: number;
  /** Share of home troops sent per expansion. */
  readonly expandShare: number;
  /** Consider attacking players once home troops reach this share of capacity. */
  readonly attackAt: number;
  /** Aim to send this many times the defender's home troops (enough to take everything). */
  readonly attackEdge: number;
  /**
   * Without that edge, still attack if the army is expected to take at least this share
   * of the target's land before it runs out (Lanchester estimate, GAME_DESIGN.md §3.6).
   */
  readonly minLandGain: number;
  /** Most of its home troops it commits to one attack. */
  readonly attackMaxShare: number;
  /** Attacks players even while neutral land is still within reach. */
  readonly attacksWhileExpanding: boolean;
  /** Extra preference for targets busy fighting someone else (their home pool is low). */
  readonly preferBusyTargets: number;
  /**
   * A neighbour this many times stronger (troops at home and in the field) is welcome as
   * an ally with no other reason: appeasement (GAME_DESIGN.md §3.14).
   */
  readonly allyWithout: number;
  /** Multiplies the difficulty's betrayal chance (0 = never betrays). */
  readonly betrayal: number;
}

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * A nation's difficulty (GAME_DESIGN.md §3.13): reaction time and decision quality only —
 * never stats (D-012).
 */
export interface DifficultyRules {
  /** Thinks every thinkMinTicks..thinkMaxTicks ticks, randomly staggered. */
  readonly thinkMinTicks: number;
  readonly thinkMaxTicks: number;
  /** Answers incoming armies with a counter-attack. */
  readonly counters: boolean;
  /** Tops up wars that can still be won (otherwise lets them run out). */
  readonly reinforces: boolean;
  /** Betrays an ally when an attack is expected to take at least this share of their land… */
  readonly betrayMinGain: number;
  /** …with this chance (times the personality's betrayal factor). */
  readonly betrayChance: number;
  /** Share of alliance answers flipped at random ("confused" nations). */
  readonly allyConfusion: number;
}

/**
 * Tribes (GAME_DESIGN.md §3.13, D-017): many weak filler bots, weaker by stats and simple.
 */
export interface TribeRules {
  /** Share of the normal troop capacity. */
  readonly capacityShare: number;
  /** Share of the normal troop growth. */
  readonly growthShare: number;
  /** Anyone but a tribe pays this share of the normal losses per tribe tile taken. */
  readonly lossWhenAttacked: number;
  /** Thinks every thinkMinTicks..thinkMaxTicks ticks. */
  readonly thinkMinTicks: number;
  readonly thinkMaxTicks: number;
  /** Expands once home troops reach this share of capacity… */
  readonly expandAt: number;
  /** …and attacks a neighbour (when no open land is near) from this share… */
  readonly attackAt: number;
  /** …sending this share of its home troops… */
  readonly attackShare: number;
  /** …if that army is expected to take at least this share of the target's land. */
  readonly minLandGain: number;
}

export interface AiRules {
  /** Nations by difficulty. */
  readonly difficulties: Readonly<Record<Difficulty, DifficultyRules>>;
  /**
   * Nations weigh tribe targets this many times higher: eat the tribes first, then fight
   * the other nations (GAME_DESIGN.md §3.13).
   */
  readonly tribePreference: number;
  /**
   * Nations weigh a traitor (someone who just broke an alliance) this many times higher as
   * a target, on top of the traitor discount (GAME_DESIGN.md §3.14).
   */
  readonly traitorPreference: number;
  /**
   * Team games (GAME_DESIGN.md §3.15): nations weigh an enemy attacking one of their
   * teammates this many times higher ("help teammates")…
   */
  readonly teamAssistPreference: number;
  /** …and an enemy a teammate is already attacking this many times higher ("gang up"). */
  readonly teamFocusPreference: number;
  /** Wars on tribes a nation runs at once (against nations: one at a time). */
  readonly maxTribeWars: number;
  /** Counter an incoming army when home troops are at least this many times its size... */
  readonly counterAbove: number;
  /** ...sending this many times its size (the armies cancel; the rest pushes on). */
  readonly counterSize: number;
  /**
   * Retreat an attack whose army fell below this share of the defender's home troops:
   * it would take only ~3% more of their land, and retreating saves 80% of it.
   */
  readonly retreatBelow: number;
  /** At or above this share of capacity troops stop growing: a waste. */
  readonly wastingAt: number;
  /** While wasting growth, bots accept attacks that gain this much less land. */
  readonly wastingGainFactor: number;
  /**
   * Boredom: each think spent at the cap without acting lowers the land gain a bot
   * demands, reaching zero after this many thinks — so bots never sit at full capacity
   * forever (two big, cautious bots used to stare at each other until the time limit).
   */
  readonly boredomThinks: number;
  /** An expansion with fewer troops than this gets topped up… */
  readonly expansionTopUpBelow: number;
  /** …or with less than this many ticks of what its front can spend. */
  readonly expansionTopUpTicks: number;
  /**
   * Expansions carry what their front can spend in this many ticks (a front takes one
   * layer per layer delay, so a bigger army would only sit in the field)…
   */
  readonly expansionHorizonTicks: number;
  /**
   * …but no more than the open land within reach costs, times this margin (some of it
   * goes to neighbours first; leftovers come home when the land runs out).
   */
  readonly expansionMargin: number;
  /**
   * An expansion bigger than this share of capacity and more than twice what the land
   * left in reach costs is called back (free from neutral land) and resent smaller.
   */
  readonly expansionRecallAbove: number;
  /** Distance (tiles) beyond the bot's own radius where it looks for open land to aim at. */
  readonly expansionLookAhead: number;
  /**
   * Economy (GAME_DESIGN.md §3.16): right before attacking a player, nations mobilize all
   * their gold can buy (a war chest) — if that's at least this share of their capacity.
   */
  readonly mobilizeMinShare: number;
  /** Nations give a teammate or human ally who is losing a war this share of their home troops… */
  readonly donateTroopsShare: number;
  /**
   * …and, when they sit at the cap (gold they can't use), this share of their gold to the
   * one whose home troops are lowest, below this share of their capacity.
   */
  readonly donateGoldShare: number;
  readonly giftGoldBelow: number;
  /** Nations hold at most this many alliances (GAME_DESIGN.md §3.14). */
  readonly maxAlliances: number;
  /** Nations never ally (or renew with) a player holding this share of the land or more. */
  readonly allyLeaderShare: number;
  /** A far-away player, or a neighbour while at war elsewhere, must be this strong (×). */
  readonly allyMinStrength: number;
  /** Nations refuse a player their own attack is expected to take this much land from. */
  readonly allyRefuseWhenWinning: number;
  /** Nations ask the same player at most this often. */
  readonly allyRequestEveryTicks: number;
  /** A nation refuses alliances with whoever betrayed it, for this long. */
  readonly grudgeTicks: number;
  readonly personalities: Readonly<Record<Personality, PersonalityRules>>;
  /** Buildings (GAME_DESIGN.md §3.17). */
  readonly build: BuildAiRules;
}

export interface GameRules {
  /** Simulation tick length. 10 ticks per second (D-004). */
  readonly tickMs: number;
  readonly troops: TroopRules;
  readonly spawn: SpawnRules;
  readonly expansion: ExpansionRules;
  readonly combat: CombatRules;
  readonly attack: AttackRules;
  readonly encirclement: EncirclementRules;
  readonly elimination: EliminationRules;
  readonly victory: VictoryRules;
  readonly ai: AiRules;
  readonly tribe: TribeRules;
  readonly diplomacy: DiplomacyRules;
  readonly economy: EconomyRules;
  readonly buildings: BuildingRules;
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
    // Random disc packing fills at most ~55% of the area, so centres at 0.7 × the even
    // spacing still fit. 8 players: min(70, 160) = 70 (unchanged); 126 players on the
    // reference map: 40 (milestone 2.0).
    randomSpacingShare: 0.7,
    // Tribes are scattered at random, clumps and all (2.1 playtest: evenly spread tribes
    // looked "very organized"); 9 = two disc radii + 1, so discs never overlap.
    tribeMinDistance: 9,
    tribeRivalDistance: 20,
    randomMinLandShare: 0.8,
  },
  expansion: {
    // Cheap enough that early growth outpaces expansion (a race limited by speed and
    // geography); costly enough that big frontiers later make direction a real choice.
    costPerTile: { plains: 3, highland: 4, mountain: 6 },
    // Measured with tools/speeds.ts (milestone 1.7, after the playtest: "land grabs feel
    // long; grass should be fastest, mountains slow"): ~6 tiles/s on grass, ~3.5 on
    // highland, ~1.5 on mountains — geography shapes the land race. With 8 bots, 90% of
    // the land is taken after ~2 min.
    layerDelayTicks: 1.5,
    terrainDelay: { plains: 1, highland: 1.7, mountain: 4 },
    fullSpeedArmy: 2_000,
    minSpeedShare: 0.1,
  },
  combat: {
    // Mountains: ~1.5× losses and ~2.5× slower than plains — a natural defensive line.
    terrainLoss: { plains: 1, highland: 1.25, mountain: 1.5 },
    terrainDelay: { plains: 1, highland: 1.5, mountain: 2.5 },
    // At r = 1 against density d, a tile costs 3 + 1.2·d while the defender loses d.
    // Because the cost scales with r (= D/A), a fight follows Lanchester's square law:
    // an army A takes everything from a home pool D when A² > 1.2·D², i.e. with ~10% more
    // troops. Equal armies stall (the defender keeps ~40%), so attacking needs an edge,
    // and sending twice the defender's pool (r = 0.5) halves the cost per tile.
    lossBase: 3,
    lossDensity: 1.2,
    lossRatioMin: 0.5,
    lossRatioMax: 2.5,
    // ~2 tiles/s at even odds on grass: slow enough to react to. The crush curve makes a
    // much bigger army flood a small player (tools/speeds.ts): 2× → ~6 tiles/s,
    // 4× → ~14, 10× and more → ~20 (the cap: two layers per tick).
    layerDelayTicks: 4,
    crushExponent: 1.3,
    delayRatioMin: 0.05,
    delayRatioMax: 8,
    hopelessRatio: 20,
  },
  attack: {
    // The attack widens along the border at ~3 tiles per tick from the point nearest
    // the click; noticeable on long borders, irrelevant on short ones.
    focusSpread: 0.35,
    // A step straight away from the click point takes twice as long as one toward it.
    focusPull: 1,
    // Tips grow fastest, together with each attack's veins and some jitter: fronts look
    // like a growing colony rather than a geometric shape. Tuned so that the average
    // spread speed matches the old round fronts (same balance, different look).
    fillShare: -0.4,
    noiseShare: 0.67,
    growth: { veinScale: 0.05, veinSharpness: 3, onVein: 0.45, offVein: 1.5 },
    retreatTicks: 20,
    retreatPenalty: 0.2,
  },
  encirclement: {
    // Every 2 s: frequent enough to feel instant, cheap because it's staggered and
    // skipped for players whose surroundings didn't change.
    intervalTicks: 20,
    mainTerritoryArmyShare: 1,
  },
  elimination: {
    // Small remnants are absorbed to avoid tedious mop-up — but only once a player has
    // lost most of what they held: a fresh 49-tile start that loses 10 tiles keeps going.
    absorbBelowTiles: 40,
    absorbBelowPeakShare: 0.25,
  },
  victory: {
    landShare: 0.7,
    // Anti-stall: almost every game ends by 16 min. After 15 min the requirement drops
    // 1% every 30 s, reaching 50% at 25 min — so two equal players who keep cancelling
    // each other's attacks (a 1% case in bot games, up to 60 min) can't stall forever.
    declineStartTicks: 9_000,
    declineStepTicks: 300,
    declineStep: 0.01,
    minLandShare: 0.5,
  },
  ai: {
    // Hard is how every bot played in Phase 1 (2–5 s, full logic).
    difficulties: {
      // Betrayal (§3.14): Hard betrays only for a sure kill, Easy at random and earlier.
      easy: {
        thinkMinTicks: 60,
        thinkMaxTicks: 100,
        counters: false,
        reinforces: false,
        betrayMinGain: 0.5,
        betrayChance: 0.15,
        allyConfusion: 0.25,
      },
      medium: {
        thinkMinTicks: 40,
        thinkMaxTicks: 70,
        counters: true,
        reinforces: false,
        betrayMinGain: 0.9,
        betrayChance: 0.3,
        allyConfusion: 0.1,
      },
      hard: {
        thinkMinTicks: 20,
        thinkMaxTicks: 50,
        counters: true,
        reinforces: true,
        betrayMinGain: 0.99,
        betrayChance: 1,
        allyConfusion: 0,
      },
    },
    // Milestone 2.1 trace (10 nations + 100 tribes): without these, nations fought each
    // other from minute 2 and the survivor then ate ~50 tribes one by one (~3 a minute).
    tribePreference: 3,
    // User request (2.2): breaking an alliance should make you a target for nations too.
    traitorPreference: 2,
    // Teams (2.3): a team focuses its fire — defend teammates first, then pile on.
    teamAssistPreference: 2,
    teamFocusPreference: 1.5,
    maxTribeWars: 3,
    counterAbove: 1.1,
    counterSize: 1.3,
    retreatBelow: 0.3,
    wastingAt: 0.95,
    wastingGainFactor: 0.6,
    boredomThinks: 10,
    expansionTopUpBelow: 300,
    expansionTopUpTicks: 50,
    expansionHorizonTicks: 150,
    expansionMargin: 1.25,
    expansionRecallAbove: 0.05,
    expansionLookAhead: 40,
    // Economy (§3.16): gold is a war chest, spent on attacks; gifts go to friends in need.
    mobilizeMinShare: 0.02,
    donateTroopsShare: 0.25,
    donateGoldShare: 0.5,
    giftGoldBelow: 0.5,
    // Alliances (§3.14): a nation allies at most two players, never the runaway leader,
    // and keeps asking a reluctant player no more than every 90 s.
    maxAlliances: 2,
    allyLeaderShare: 0.25,
    allyMinStrength: 0.6,
    allyRefuseWhenWinning: 0.4,
    allyRequestEveryTicks: 900,
    grudgeTicks: 3_000,
    // Every bot waits for its troops to regrow toward the 50% sweet spot before acting:
    // a player who keeps sending most of their pool barely grows.
    personalities: {
      expander: {
        expandAt: 0.35,
        expandShare: 0.45,
        attackAt: 0.65,
        attackEdge: 1.5,
        minLandGain: 0.3,
        attackMaxShare: 0.7,
        attacksWhileExpanding: false,
        preferBusyTargets: 0,
        allyWithout: 1.25,
        betrayal: 0.5,
      },
      aggressor: {
        expandAt: 0.45,
        expandShare: 0.35,
        attackAt: 0.5,
        attackEdge: 1.2,
        minLandGain: 0.15,
        attackMaxShare: 0.85,
        attacksWhileExpanding: true,
        preferBusyTargets: 0.3,
        allyWithout: 1.5,
        betrayal: 1,
      },
      turtle: {
        expandAt: 0.5,
        expandShare: 0.3,
        attackAt: 0.75,
        attackEdge: 1.7,
        minLandGain: 0.4,
        attackMaxShare: 0.6,
        attacksWhileExpanding: false,
        preferBusyTargets: 0,
        allyWithout: 0.8,
        betrayal: 0,
      },
      opportunist: {
        expandAt: 0.4,
        expandShare: 0.4,
        attackAt: 0.55,
        attackEdge: 1.3,
        minLandGain: 0.25,
        attackMaxShare: 0.75,
        attacksWhileExpanding: false,
        preferBusyTargets: 1,
        allyWithout: 1.25,
        betrayal: 1,
      },
    },
    // Buildings (§3.17): like OpenFront's nations, Housing first; Factories next; upgrades
    // once the land is "full". Most gold stays a war chest for attacks (§3.16).
    build: {
      goalHorizonTicks: 1_200,
      saving: { expander: 0.8, aggressor: 0.4, turtle: 1, opportunist: 0.6 },
      tilesPerBuilding: 4_000,
      // Value an option by what it returns over the next ~2.5 min (income) / 1 min (growth).
      incomeHorizonTicks: 1_500,
      growthHorizonTicks: 600,
      placementSamples: 24,
    },
  },
  tribe: {
    // OpenFront's tribes have a third of the troops and half the growth (research §3.4);
    // ours match, so they are "food": the obvious first targets once the land runs out.
    capacityShare: 1 / 3,
    growthShare: 0.5,
    // Taking a tribe's land costs nations and humans 30% less (tribes fight each other at
    // full cost), so eating tribes pays even against their full home pool.
    lossWhenAttacked: 0.7,
    // Slow and simple (4–8 s): cheap to run with a hundred of them.
    thinkMinTicks: 40,
    thinkMaxTicks: 80,
    expandAt: 0.3,
    attackAt: 0.55,
    attackShare: 0.3,
    minLandGain: 0.1,
  },
  diplomacy: {
    enabled: true,
    // 20 s to answer, 30 s before asking the same player again, 5 min alliances renewed in
    // their last 30 s (OpenFront's proven timings, research §3.19).
    requestTicks: 200,
    requestCooldownTicks: 300,
    durationTicks: 3_000,
    renewWindowTicks: 300,
    // A short, sharp window: 30 s in which the betrayed side and its neighbours pay 40%
    // less per tile and move a third faster against the traitor.
    traitorTicks: 300,
    traitorLoss: 0.6,
    traitorDelay: 0.75,
  },
  economy: {
    enabled: true,
    // Spending all income on Mobilize adds ~20% of peak troop growth at every size: 49
    // tiles → 16 gold/tick (peak growth 75), 50k → 189 (1,040), 200k → 367 (1,900).
    incomeBase: 10,
    incomePerSqrtTile: 0.8,
    // Like their troop growth (D-017); unspent, it is the prize for eating them.
    tribeIncomeShare: 0.5,
    // One gold, one troop: the HUD's two numbers compare directly.
    goldPerTroop: 1,
    // User (2.4): conquering a player gives you all of their leftover gold.
    lootShare: 1,
    // 10 s per friend and kind: enough to rescue an ally, too slow to pump one player.
    donationCooldownTicks: 100,
  },
  buildings: {
    enabled: true,
    // OpenFront keeps 15 tiles on maps ~3× ours (research §3.14).
    minSpacing: 8,
    // +25% per level owned of a type, at most ×3: spam gets dear, a few strong buildings don't.
    escalationPerLevel: 0.25,
    escalationMax: 3,
    priceRounding: 1_000,
    cancelRefund: 0.5,
    maxGrowthBonus: 0.2,
    // Prices sized to our economy (§3.17.12): ~40k gold by 1:00, ~200k by 3:00, ~650k by 6:00.
    // Every level step gives about as much per gold as the level before it (plus a new
    // ability), so upgrading is never a trap — and a level-I building is cheap, not better.
    types: {
      // The gold → army engine (OpenFront's City). A fixed bonus: small players gain the most.
      housing: {
        onCapture: "downgrade",
        levels: [
          { name: "Housing", cost: 40_000, buildTicks: 50, capacity: 30_000 },
          {
            name: "Developed Housing",
            cost: 90_000,
            buildTicks: 100,
            capacity: 90_000,
            growthBonus: 0.05,
          },
          {
            name: "Metropolis",
            cost: 220_000,
            buildTicks: 200,
            capacity: 250_000,
            growthBonus: 0.1,
            income: 20,
          },
        ],
      },
      // Gold, and cheaper Mobilize. Each step pays for itself in ~3.5 min.
      factory: {
        onCapture: "downgrade",
        levels: [
          { name: "Factory", cost: 60_000, buildTicks: 50, income: 30 },
          {
            name: "Industrial Complex",
            cost: 120_000,
            buildTicks: 100,
            income: 90,
            mobilizeDiscount: 0.1,
          },
          {
            name: "Mega Industrial Complex",
            cost: 280_000,
            buildTicks: 200,
            income: 220,
            mobilizeDiscount: 0.2,
          },
        ],
      },
    },
  },
});

/** A copy of the default rules with some values overridden (tests, tuning experiments). */
export function makeRules(overrides: {
  troops?: Partial<TroopRules>;
  spawn?: Partial<SpawnRules>;
  expansion?: Partial<ExpansionRules>;
  combat?: Partial<CombatRules>;
  attack?: Partial<AttackRules>;
  encirclement?: Partial<EncirclementRules>;
  elimination?: Partial<EliminationRules>;
  victory?: Partial<VictoryRules>;
  ai?: Partial<AiRules>;
  tribe?: Partial<TribeRules>;
  diplomacy?: Partial<DiplomacyRules>;
  economy?: Partial<EconomyRules>;
  buildings?: Partial<BuildingRules>;
}): GameRules {
  return deepFreeze({
    ...DEFAULT_RULES,
    troops: { ...DEFAULT_RULES.troops, ...overrides.troops },
    spawn: { ...DEFAULT_RULES.spawn, ...overrides.spawn },
    expansion: { ...DEFAULT_RULES.expansion, ...overrides.expansion },
    combat: { ...DEFAULT_RULES.combat, ...overrides.combat },
    attack: { ...DEFAULT_RULES.attack, ...overrides.attack },
    encirclement: { ...DEFAULT_RULES.encirclement, ...overrides.encirclement },
    elimination: { ...DEFAULT_RULES.elimination, ...overrides.elimination },
    victory: { ...DEFAULT_RULES.victory, ...overrides.victory },
    ai: { ...DEFAULT_RULES.ai, ...overrides.ai },
    tribe: { ...DEFAULT_RULES.tribe, ...overrides.tribe },
    diplomacy: { ...DEFAULT_RULES.diplomacy, ...overrides.diplomacy },
    economy: { ...DEFAULT_RULES.economy, ...overrides.economy },
    buildings: { ...DEFAULT_RULES.buildings, ...overrides.buildings },
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
