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
  /**
   * …in team games, the share a team's members need together (2B.6 balance pass: at 70%
   * a team of four reached it as the land race ended, before any level-III building)…
   */
  readonly teamLandShare: number;
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
 * Gold (GAME_DESIGN.md §3.16): earned from land, spent on buildings, walls and missiles,
 * given to friends (Mobilize, gold into instant troops, was removed: D-033). Model E2 of §6.1.
 */
export interface EconomyRules {
  /** false: no gold at all (games play exactly as before milestone 2.4). */
  readonly enabled: boolean;
  /** Gold per tick of play: incomeBase + incomePerSqrtTile · √tiles, rounded down. */
  readonly incomeBase: number;
  readonly incomePerSqrtTile: number;
  /** Tribes earn this share of the income (and never spend it: it becomes loot). */
  readonly tribeIncomeShare: number;
  /** What a troop is worth in gold, to nations weighing a missile (troops it kills). */
  readonly goldPerTroop: number;
  /** Whoever eliminates a player takes this share of their gold. */
  readonly lootShare: number;
  /** Each kind of donation (troops, gold) to the same friend at most this often. */
  readonly donationCooldownTicks: number;
}

/**
 * Building types built so far (GAME_DESIGN.md §3.17). The air/strategic buildings (Phase
 * 2B) join this list in their own milestones (Airport: 2B.1, SAM: 2B.2, Missile Silo: 2B.5).
 * Border Defense is not a one-tile building but a drawn wall (D-024): see WallRules.
 */
export const BUILDING_TYPES = ["housing", "factory", "port", "airport", "sam", "silo"] as const;
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
  /**
   * Ports (GAME_DESIGN.md §3.18): boats launched within `range` tiles of it sail this many
   * times faster…
   */
  readonly boatSpeed?: number;
  readonly range?: number;
  /** …the owner may have this many more boats at sea… */
  readonly boatSlots?: number;
  /** …and landings from it pay this share of the normal losses per tile (Marines). */
  readonly boatLoss?: number;
  /** Ports (GAME_DESIGN.md §3.19): it sends a trade ship this often (ticks). */
  readonly tradeEveryTicks?: number;
  /**
   * Airports (GAME_DESIGN.md §3.17.7): an airlift carries at most this share of the owner's
   * troop capacity, to friends' land within `range` tiles…
   */
  readonly liftShare?: number;
  /** …and the Airport's missions are ready again this many ticks after a launch. */
  readonly missionCooldownTicks?: number;
  /**
   * Air Base (Airport III, 2B.4): air strikes, ready again this many ticks after one (their
   * own cooldown, mission slot 1), within `range`…
   */
  readonly strikeCooldownTicks?: number;
  /** …and this many escort fighters fly with every lift and assault. */
  readonly escorts?: number;
  /**
   * SAMs (GAME_DESIGN.md §3.17.7): it holds this many interceptors, each of which destroys
   * one hostile plane within `range` tiles…
   */
  readonly interceptors?: number;
  /** …and reloads them one at a time, each taking this many ticks. */
  readonly reloadTicks?: number;
  /** SAM II+ (2B.5): its interceptors also shoot down conventional missiles… */
  readonly interceptsMissiles?: boolean;
  /**
   * …SAM III: and the strategic warhead; and its early warning announces hostile launches
   * within `earlyWarning` × its radius to its owner (the HUD).
   */
  readonly interceptsWarheads?: boolean;
  readonly earlyWarning?: number;
  /**
   * Missile Silos (GAME_DESIGN.md §3.17.8, 2B.5): it holds this many missiles (slots), each
   * reloaded in `reloadTicks` one at a time, and fires them at targets within `range` tiles —
   * or anywhere on the map (`wholeMap`)…
   */
  readonly missileSlots?: number;
  readonly wholeMap?: boolean;
  /** …at level II also the bunker buster… */
  readonly bunkerBuster?: boolean;
  /** …at level III the strategic warhead, ready again this many ticks after one. */
  readonly warheadCooldownTicks?: number;
  /**
   * Factory III's war production (2B.5): the owner's Airports and Silos within
   * `warProductionRange` tiles of it reload and cool down in `warProductionFactor`× the time.
   */
  readonly warProductionRange?: number;
  readonly warProductionFactor?: number;
  /**
   * Naval Base (Port III, 2B.6, D-031): it keeps this many warships at sea, patrolling within
   * `patrolRange` tiles of it (rules.warships)…
   */
  readonly warships?: number;
  readonly patrolRange?: number;
  /**
   * …and its owner's coast within `range` tiles of it is fortified like a wall of this level
   * (coastal fortification: landings and attacks along that coast pay the wall's price).
   */
  readonly coastFort?: number;
}

export interface BuildingTypeRules {
  /** Levels I, II, III (the Port's level III, the Naval Base, only with rules.warships). */
  readonly levels: readonly BuildingLevelRules[];
  /**
   * Where it can stand: any land of yours, a coast tile (next to the sea), or flat land
   * (plains — an Airport's runway).
   */
  readonly placement: "land" | "coast" | "plains";
  /**
   * When its tile is captured: the taker adopts it at its level (user, 2.5 playtest), or it
   * is destroyed outright (e.g. Border Defense, 2.6: a wall doesn't change sides).
   */
  readonly onCapture: "adopt" | "destroy";
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

/** One level of a wall (GAME_DESIGN.md §3.17.6, D-024). */
export interface WallLevelRules {
  /** Display name ("Stone Wall"). */
  readonly name: string;
  /** Gold per wall tile to build it (level I) or upgrade to it, before escalation. */
  readonly costPerTile: number;
  /** Construction or upgrade time: this many ticks plus `buildTicksPerTile` per tile. */
  readonly buildTicks: number;
  readonly buildTicksPerTile: number;
  /** An attack taking a wall tile pays this many times the normal losses… */
  readonly loss: number;
  /** …plus this many troops (breaking the wall itself)… */
  readonly breakTroops: number;
  /** …and the tile falls this many ticks later than a normal tile would. */
  readonly holdTicks: number;
  /**
   * Flak (Fortress Wall, 2B.3): a hostile flight that flies within this many tiles of a
   * standing tile of the wall loses one plane — each time it flies into that reach.
   */
  readonly flakRadius?: number;
}

/**
 * Walls (GAME_DESIGN.md §3.17.6, D-024): lines of tiles a player draws on their own land,
 * point by point. Each wall tile holds an attack for a while and costs it extra troops;
 * a wall tile taken by anyone breaks.
 */
export interface WallRules {
  /** Corner points per wall (A, B, C …), at most. */
  readonly maxPoints: number;
  /** Tiles per wall, at most (a whole front, not a whole country). */
  readonly maxTiles: number;
  readonly levels: readonly [WallLevelRules, WallLevelRules, WallLevelRules];
  /**
   * Price escalation: every this many wall tile-levels a player already owns make walls
   * `rules.buildings.escalationPerLevel` dearer (same cap as buildings).
   */
  readonly escalationTiles: number;
}

/**
 * Boats (GAME_DESIGN.md §3.18, milestone 2.7): troops sail from any coast of yours to a
 * coast across the water and land as a beachhead attack.
 */
export interface NavalRules {
  /** false: no boats (games play as before milestone 2.7). */
  readonly enabled: boolean;
  /** Boats a player may have at sea at once, before Ports… */
  readonly maxBoats: number;
  /** …and at most this many with them. */
  readonly maxBoatsWithPorts: number;
  /** Sea tiles a boat sails per tick (before a Port's speed). */
  readonly tilesPerTick: number;
  /** A landing goes to the target's coast nearest the click, searched this far around it. */
  readonly landingSearchTiles: number;
  /** Route search gives up after visiting this many sea tiles ("no sea route"). */
  readonly maxRouteNodes: number;
}

/**
 * Trade ships (GAME_DESIGN.md §3.19, milestone 2.8): every Port sends ships to other players'
 * Ports on its sea; when one docks, both owners earn gold.
 */
export interface TradeRules {
  /** false: no trade ships (Ports earn only their harbour income). Needs boats and buildings. */
  readonly enabled: boolean;
  /** Gold each side earns per trip: goldBase + goldPerTile · route tiles, at most goldMax. */
  readonly goldBase: number;
  readonly goldPerTile: number;
  readonly goldMax: number;
  /** Sea tiles a trade ship sails per tick. */
  readonly tilesPerTick: number;
  /** Trade ships at sea in the whole game, at most (a Port's next ship waits otherwise). */
  readonly maxShips: number;
}

/**
 * Warships (GAME_DESIGN.md §3.18.1, milestone 2B.6, D-031 — the user's choices): every Naval
 * Base (Port III) keeps its warships patrolling the sea around it on their own (nobody steers
 * them). They shoot at ships of players who are not their owner's friends (allies and
 * teammates are safe) within their patrol area: troop boats first (one shell sinks one, the
 * troops aboard are lost), then warships, then trade ships, which they capture.
 */
export interface WarshipRules {
  /** false: no Naval Base and no warships (games play as in 2B.5). Needs boats and buildings. */
  readonly enabled: boolean;
  /** Sea tiles a warship sails per tick. */
  readonly tilesPerTick: number;
  /** Health; each shell from another warship takes `shellDamage`. */
  readonly hp: number;
  readonly shellDamage: number;
  /** A warship hits (or boards) a ship within this many tiles of it… */
  readonly gunRange: number;
  /** …once every this many ticks. */
  readonly reloadTicks: number;
  /** A chase is re-planned this often (ticks): the prey moves. */
  readonly repathTicks: number;
  /** A sunk warship is back at its Naval Base after this many ticks. */
  readonly rebuildTicks: number;
  /** Health mended per tick while it has nothing to shoot at. */
  readonly repairPerTick: number;
  /** A warship's route search gives up after visiting this many sea tiles. */
  readonly maxRouteNodes: number;
  /**
   * Player orders (the user after playing 2B.6): a warship sent somewhere patrols and fights
   * within `orderRange` tiles of that spot; on the way there it fires at what comes within
   * gun range but chases nothing.
   */
  readonly orderRange: number;
  /** Patrol points keep at least this many tiles of open water to the nearest land. */
  readonly offshore: number;
}

/** The kinds of map ping (GAME_DESIGN.md §3.20): "attack here", "defend here", "watch out". */
export type PingKind = "attack" | "defend" | "watch";
export const PING_KINDS: readonly PingKind[] = ["attack", "defend", "watch"];

/**
 * Emojis and map pings (GAME_DESIGN.md §3.20, milestone 2.9): the only way to talk in game —
 * no free text (moderation). Both are commands, so they work the same in multiplayer.
 */
export interface ChatRules {
  /** false: the emote and ping commands are rejected. */
  readonly enabled: boolean;
  /** The emojis a player can send, by index (commands carry the index, never text). */
  readonly emojis: readonly string[];
  /** Ticks between two emojis from the same player. */
  readonly emoteCooldownTicks: number;
  /** Ticks an emoji shows over the sender's land. */
  readonly emoteShowTicks: number;
  /** Ticks between two pings from the same player. */
  readonly pingCooldownTicks: number;
  /** Ticks a ping stays on the map (and in nations' minds). */
  readonly pingTicks: number;
  /** A player's pings on the map at once, at most (the oldest goes). */
  readonly maxPingsPerPlayer: number;
  /** Nations: target-score multiplier for a player a friend pinged "attack" on. */
  readonly pingAttackPreference: number;
  /** Nations: target-score multiplier for a player attacking a friend who pinged "defend". */
  readonly pingDefendPreference: number;
  /** Nations: the smallest land gain they accept against a pinged target, as a share of usual. */
  readonly pingMinGainFactor: number;
  /** Nations: ticks between their own pings to human friends. */
  readonly nationPingCooldownTicks: number;
  /** Nations ask human friends for help when attacks on them hold this × their home troops. */
  readonly nationHelpThreshold: number;
  /** Nations: chance (0–1) of answering an emoji or reacting to a human's move with one. */
  readonly nationEmoteChance: number;
}

/**
 * Flights (GAME_DESIGN.md §3.17.7, milestone 2B.0): planes fly in a straight line from where
 * they took off to their target at a fixed speed, visible to everyone, with an ETA.
 * Airlifts, assaults, strikes and missiles (2B.1–2B.5) are all flights.
 */
export interface FlightRules {
  /** Tiles per tick of each kind of plane: transports (airlift, assault)… */
  readonly transportTilesPerTick: number;
  /** …fighters (air strikes, escorts)… */
  readonly fighterTilesPerTick: number;
  /** …and missiles. */
  readonly missileTilesPerTick: number;
  /**
   * DEBUG ONLY (2B.0, until Airports exist): accept the `testFlight` command, which flies
   * `testFlightPlanes` empty transports from your land to any tile and does nothing on
   * arrival. Off in real games; dev builds of the client turn it on for browser checks.
   */
  readonly testFlights: boolean;
  readonly testFlightPlanes: number;
  /** false: no Airports and no air missions (games play as before Phase 2B, headless --no-flights). */
  readonly enabled: boolean;
  /** Transports per airlift (GAME_DESIGN.md §3.17.7): the load is split evenly over them. */
  readonly airliftPlanes: number;
  /**
   * Airborne assaults (Airport II, GAME_DESIGN.md §3.17.7, 2B.3): transports per assault, and
   * the landed army's losses per tile as a share of normal (light infantry: dearer).
   */
  readonly assaultPlanes: number;
  readonly airborneLoss: number;
  /**
   * Air strikes (Air Base, GAME_DESIGN.md §3.17.7, 2B.4): fighters per strike. On a
   * building: at least `strikeDamagePlanes` arriving cost it a level (a level-I building is
   * destroyed); any arriving disable it for `strikeDisableTicks`…
   */
  readonly strikePlanes: number;
  readonly strikeDamagePlanes: number;
  readonly strikeDisableTicks: number;
  /**
   * …on a point: the target's land within `suppressionRadius` tiles is suppressed for
   * `suppressionTicks` — no working fortification, and attacks there pay `suppressedLoss`×
   * the losses.
   */
  readonly suppressionRadius: number;
  readonly suppressionTicks: number;
  readonly suppressedLoss: number;
  /**
   * Missiles (Missile Silo, GAME_DESIGN.md §3.17.8, 2B.5), one "plane" each. A conventional
   * missile (strike missile or bunker buster) costs `missileCost` gold to launch. The strike
   * missile: every enemy building within `missileRadius` tiles of the target loses
   * `missileLevels` level(s), and the target's land there is suppressed (as by an air strike)
   * for `missileSuppressionTicks`…
   */
  readonly missileCost: number;
  readonly missileRadius: number;
  readonly missileLevels: number;
  readonly missileSuppressionTicks: number;
  /** …the bunker buster: the enemy building at the target loses `busterLevels` levels… */
  readonly busterLevels: number;
  /** …and a building a missile hits is out of action for this long. */
  readonly missileDisableTicks: number;
  /**
   * Missiles kill people too (the user after playing 2B.6): the player whose land a strike
   * missile hits loses this share of their home troops; a bunker buster's victim this one.
   */
  readonly missileTroopShare: number;
  readonly busterTroopShare: number;
  /**
   * Splash (the user after the Phase 2B playtest, D-033): a strike missile also blasts a
   * crater — enemy land within `craterRadius` of the target becomes neutral (but the tiles of
   * buildings still standing; its owners lose home troops in proportion to the land lost),
   * costing `scorchedCost`× to retake for `craterTicks`…
   */
  readonly craterRadius: number;
  readonly craterTicks: number;
  /** …and a bunker buster costs every other enemy building within `busterSplashRadius` `busterSplashLevels` level(s). */
  readonly busterSplashRadius: number;
  readonly busterSplashLevels: number;
  /**
   * The strategic warhead (Silo III) costs `warheadCost`: everyone's land within
   * `warheadRadius` of the target but the launcher's and their teammates' becomes neutral
   * scorched land — its buildings destroyed, its owner losing home troops in proportion to
   * the land lost — on which expansion costs `scorchedCost`× for `scorchedTicks`.
   */
  readonly warheadCost: number;
  readonly warheadRadius: number;
  readonly scorchedTicks: number;
  readonly scorchedCost: number;
}

/** How nations build (GAME_DESIGN.md §3.17, ai/build.ts). Tribes never build. */
export interface BuildAiRules {
  /**
   * A nation saves toward its best building option if it costs at most this many ticks of
   * its income (so it aims at what it can reach soon)…
   */
  readonly goalHorizonTicks: number;
  /**
   * …keeping this share of the price out of reach of gifts and missiles, by personality:
   * turtles invest, aggressors fight.
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
  /**
   * Walls (GAME_DESIGN.md §3.17.6): a neighbouring nation or human (not a friend) is a
   * threat when it attacks us or its troops are at least this share of ours…
   */
  readonly threatStrength: number;
  /** …and the bot walls off its fronts toward threats with up to this many walls… */
  readonly maxWalls: Readonly<Record<Personality, number>>;
  /**
   * …valuing a wall level at this share of its capacity (a rough "defenders it is worth"),
   * times the personality's weight…
   */
  readonly wallWorth: readonly [number, number, number];
  readonly fortifyWeight: Readonly<Record<Personality, number>>;
  /** …drawn this many tiles behind the threatened border, at most this long. */
  readonly wallDepth: number;
  readonly wallLength: number;
  /** A Port's boat speed bonus (×1.5 → 0.5) is worth this share of capacity per unit. */
  readonly portWorth: number;
  /**
   * An Airport is worth this share of capacity to a nation with a friend it can help only
   * by air (a teammate or human ally it doesn't border); nothing otherwise.
   */
  readonly airportWorth: number;
  /**
   * SAMs (GAME_DESIGN.md §3.17.7): only while a player that isn't a friend has a working
   * Airport whose range (plus `samThreatMargin` tiles) reaches the bot's land, a SAM level is
   * worth this share of capacity per interceptor, times the share of the bot's Housing /
   * Factory / Airport levels it covers…
   */
  readonly samWorth: number;
  readonly samThreatMargin: number;
  /** …and a nation keeps at most this many SAMs. */
  readonly maxSams: number;
  /**
   * Airborne assaults (2B.3): a Military Airport is worth this share of capacity while an
   * enemy nation or human has land within its reach (the Airport and its upgrade each count
   * their share of the price, so both steps are worth the same per gold).
   */
  readonly assaultWorth: number;
  /**
   * Air strikes (2B.4): the Air Base upgrade is worth this share of capacity while an enemy
   * nation or human has buildings within its reach.
   */
  readonly strikeWorth: number;
  /**
   * Missile Silos (2B.5): a Silo level is worth this share of capacity while an enemy nation
   * or human has buildings within its reach (I–II: worth strikes; III: the warhead's value
   * comes on top while a runaway leader stands — see AiRules.warheadLeaderShare).
   */
  readonly siloWorth: number;
  /**
   * Naval Base (2B.6): its warships are worth this share of capacity while a player who
   * isn't a friend has a Port on the same sea (ships to take, boats to fear); nothing
   * otherwise — the Base then pays only through its income and trade.
   */
  readonly navalBaseWorth: number;
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
  /**
   * Boats (GAME_DESIGN.md §3.18): nations look this far (tiles, straight line) across the
   * sea for unclaimed coast and for targets…
   */
  readonly seaReach: number;
  /** …and weigh a target across the sea this much (the crossing is slow and seen coming). */
  readonly seaPreference: number;
  /**
   * Airborne assaults (GAME_DESIGN.md §3.17.7, 2B.3): a target reached by air — behind its
   * walls, or not a land neighbour — weighs this much (light troops, SAMs, a pocket that
   * can be encircled once it stalls).
   */
  readonly airPreference: number;
  /**
   * Air strikes (GAME_DESIGN.md §3.17.7, 2B.4): a nation with a ready Air Base strikes the
   * enemy building worth the most gold at its level — SAMs count `strikeSamWeight`× (they
   * close the sky to assaults), Airports `strikeAirportWeight`× (they fly at us) — or, when
   * its army is breaking a walled front, suppresses the walls there, worth `suppressionWorth`×
   * the gold of the wall tiles it covers. Nothing worth less than `strikeMinValue` gold.
   */
  readonly strikeSamWeight: number;
  readonly strikeAirportWeight: number;
  readonly suppressionWorth: number;
  readonly strikeMinValue: number;
  /**
   * Missiles (GAME_DESIGN.md §3.17.8, 2B.5): a nation launches a strike missile or bunker
   * buster only when the levels it would cost enemies are worth at least `missileValueFactor`×
   * its price (and never into SAMs that would stop it)…
   */
  readonly missileValueFactor: number;
  /**
   * …and the strategic warhead only at a runaway leader: a nation or human (not a friend)
   * holding at least `warheadLeaderShare` of all owned land, at the spot where it hits the
   * most of their land.
   */
  readonly warheadLeaderShare: number;
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
   * Economy (GAME_DESIGN.md §3.16): nations give gold away only when they have at least this
   * share of their capacity in gold to spare.
   */
  readonly giftGoldMinShare: number;
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
  readonly walls: WallRules;
  readonly naval: NavalRules;
  readonly trade: TradeRules;
  readonly chat: ChatRules;
  readonly flights: FlightRules;
  readonly warships: WarshipRules;
}

export const DEFAULT_RULES: GameRules = deepFreeze({
  tickMs: 100,
  troops: {
    capacityBase: 10_000,
    // 650 (1,000 until D-033): land gives a third less, so Housing carries more of an army.
    capacityScale: 650,
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
    // 80% after the Phase 2B playtest (70% until then).
    landShare: 0.8,
    // Teams need more (2B.6 balance pass): at 70% two teams of four ended as the land race
    // did (5.5 min on Islands, a level-III building in 3 of 30 games); at 85%: 9.3 min, 16 of 30.
    teamLandShare: 0.85,
    // Anti-stall: after 15 min the requirement drops 1% every 30 s, reaching 50% at 30 min
    // (25 min while the goal was 70%) — so two equal players who keep cancelling
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
    // Boats (§3.18): ~30 s of sailing at most on the reference map (bigger maps scale it,
    // ai/bot.ts seaReach); a landing is worth 70% of a land war.
    seaReach: 300,
    seaPreference: 0.7,
    // Air (§3.17.7): a landing behind the lines is worth a bit less than a sea landing.
    airPreference: 0.6,
    // Strikes are free (only the cooldown limits them), so a nation always uses a ready one
    // on its best target; SAMs first — they are what stands between it and an assault.
    strikeSamWeight: 2,
    strikeAirportWeight: 1.5,
    suppressionWorth: 1,
    strikeMinValue: 30_000,
    // Missiles cost gold: only when what they destroy (building levels, troops killed) is worth
    // 1.2× their price (2× until the user found nations never fired, after 2B.6). The warhead
    // only at a player who holds a third of the owned land (a runaway leader).
    missileValueFactor: 1.2,
    warheadLeaderShare: 0.33,
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
    // Economy (§3.16): gifts go to friends in need.
    giftGoldMinShare: 0.02,
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
      // After the 2B.6 playtest ("bots don't engage in much combat"): expanders and opportunists
      // attack sooner and with a smaller edge (Islands, Medium: 375 player attacks a game, was
      // 344; median 18.6 min, was 23). Bolder turtles and aggressors tipped Continent games.
      expander: {
        expandAt: 0.35,
        expandShare: 0.45,
        attackAt: 0.58,
        attackEdge: 1.4,
        minLandGain: 0.25,
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
        attackAt: 0.5,
        attackEdge: 1.25,
        minLandGain: 0.2,
        attackMaxShare: 0.75,
        attacksWhileExpanding: false,
        preferBusyTargets: 1,
        allyWithout: 1.25,
        betrayal: 1,
      },
    },
    // Buildings (§3.17): like OpenFront's nations, Housing first; Factories next; upgrades
    // once the land is "full".
    build: {
      goalHorizonTicks: 1_200,
      saving: { expander: 0.8, aggressor: 0.4, turtle: 1, opportunist: 0.6 },
      tilesPerBuilding: 4_000,
      // Value an option by what it returns over the next ~2.5 min (income) / 1 min (growth).
      incomeHorizonTicks: 1_500,
      growthHorizonTicks: 600,
      placementSamples: 24,
      // Walls (§3.17.6): turtles wall up, aggressors rarely do. Early on a Housing is worth
      // more per gold than a wall; walls catch up as capacity grows (bigger empires defend).
      threatStrength: 0.6,
      maxWalls: { expander: 2, aggressor: 1, turtle: 3, opportunist: 2 },
      wallWorth: [0.1, 0.18, 0.26],
      fortifyWeight: { expander: 1, aggressor: 0.6, turtle: 1.3, opportunist: 1 },
      wallDepth: 5,
      wallLength: 40,
      // Ports (§3.18) are worth less than Housing early: harbour income plus a little for
      // faster boats — nations build one once the cheap options got dearer.
      portWorth: 0.2,
      // An Airport is insurance for a distant friend: worth less than the economy, so a
      // nation builds one once its cheap Housing and Factories got dearer.
      airportWorth: 0.25,
      // SAMs answer an air threat: worthless until someone hostile can fly at the bot, then
      // about a Housing per interceptor when it covers everything the bot has built.
      samWorth: 0.12,
      samThreatMargin: 60,
      maxSams: 2,
      // A late investment: worth less per gold than any economy building, so only nations
      // that have built up (or face walls) fly assaults.
      assaultWorth: 0.15,
      // A strike every 30 s is worth more than one-off assaults, but the step is so dear
      // (~1M gold with escalation) that only late leaders reach it: 0.2–0.3 Air Bases a game
      // on Islands whether this is 0.5 or 1.0 (2B.4 headless).
      strikeWorth: 0.5,
      // Silos are a late investment (0.4 until the 2B.6 playtest: nations hardly fired missiles;
      // at 0.6, 1.7 Silos and 4 missiles an Islands game at Medium).
      siloWorth: 0.6,
      // A Naval Base guards a coast and preys on trade (2B.6). At 0.3 Islands nations built
      // 4.1 a game and left Silos and Air Bases (0.4 Silos, no strikes); at 0.15: 2.7 Naval
      // Bases, 0.7 Silos, 0.5 assaults and strikes — the mix of the game without warships.
      navalBaseWorth: 0.15,
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
    // 49 tiles → 16 gold/tick, 50k → 189, 200k → 367.
    incomeBase: 10,
    incomePerSqrtTile: 0.8,
    // Like their troop growth (D-017); unspent, it is the prize for eating them.
    tribeIncomeShare: 0.5,
    // One gold, one troop (how nations value the troops a missile kills).
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
      // D-033 (the user: nations "gain a lot of troops with little to no housing"): 2.5× the
      // capacity it gave before (30k / 90k / 250k), while land gives a third less, and
      // Mobilize is gone — troops now come from land and Housing only.
      housing: {
        onCapture: "adopt",
        placement: "land",
        levels: [
          { name: "Housing", cost: 40_000, buildTicks: 50, capacity: 75_000 },
          {
            name: "Developed Housing",
            cost: 90_000,
            buildTicks: 100,
            capacity: 225_000,
            growthBonus: 0.05,
          },
          {
            name: "Metropolis",
            cost: 220_000,
            buildTicks: 200,
            capacity: 625_000,
            growthBonus: 0.1,
            income: 20,
          },
        ],
      },
      // Gold. Each step pays for itself in ~3 min. (Levels II–III also made Mobilize cheaper
      // until Mobilize was removed, D-033: their income went up instead.)
      factory: {
        onCapture: "adopt",
        placement: "land",
        levels: [
          { name: "Factory", cost: 60_000, buildTicks: 50, income: 30 },
          {
            name: "Industrial Complex",
            cost: 120_000,
            buildTicks: 100,
            income: 100,
          },
          {
            name: "Mega Industrial Complex",
            cost: 280_000,
            buildTicks: 200,
            income: 250,
            // War production (2B.5): nearby Airports and Silos reload a quarter faster.
            warProductionRange: 60,
            warProductionFactor: 0.75,
          },
        ],
      },
      // Better boats (§3.18): faster crossings and more boats at once from its stretch of
      // coast, trade ships (§3.19) plus a little harbour income, and at level II Marines (cheaper landings). Level
      // III (Naval Base) waits for Phase 2B.
      port: {
        onCapture: "adopt",
        placement: "coast",
        levels: [
          {
            name: "Port",
            cost: 50_000,
            buildTicks: 100,
            income: 5,
            boatSpeed: 1.5,
            range: 30,
            boatSlots: 1,
            tradeEveryTicks: 200,
          },
          {
            name: "Naval Port",
            cost: 120_000,
            buildTicks: 150,
            income: 15,
            boatSpeed: 2,
            range: 30,
            boatSlots: 2,
            boatLoss: 0.8,
            tradeEveryTicks: 100,
          },
          // Naval Base (2B.6, D-031): two warships guard the sea around it and its coast
          // within 30 km is fortified like a Stone Wall — a coast that is hard to land on.
          {
            name: "Naval Base",
            cost: 300_000,
            buildTicks: 200,
            income: 25,
            boatSpeed: 2,
            range: 30,
            boatSlots: 2,
            boatLoss: 0.8,
            tradeEveryTicks: 70,
            warships: 2,
            patrolRange: 40,
            coastFort: 2,
          },
        ],
      },
      // Air (§3.17.7): airlifts to friends anywhere within 250 km — the only way to send
      // troops to a friend you don't border (D-023). Level II adds the airborne assault
      // (2B.3): bigger, longer lifts that may land on an enemy's land. Level III (2B.4) adds
      // air strikes (their own cooldown) and escort fighters. On plains: a runway needs flat land.
      airport: {
        onCapture: "adopt",
        placement: "plains",
        levels: [
          {
            name: "Airport",
            cost: 120_000,
            buildTicks: 150,
            range: 250,
            liftShare: 0.1,
            missionCooldownTicks: 300,
          },
          {
            name: "Military Airport",
            cost: 300_000,
            buildTicks: 200,
            range: 300,
            liftShare: 0.15,
            missionCooldownTicks: 250,
          },
          {
            name: "Air Base",
            cost: 700_000,
            buildTicks: 250,
            range: 350,
            liftShare: 0.2,
            missionCooldownTicks: 200,
            strikeCooldownTicks: 300,
            escorts: 2,
          },
        ],
      },
      // Air defence (§3.17.7): each interceptor always destroys one hostile plane in its
      // radius, and they reload one at a time. No stacking bonuses: overlapping SAMs add
      // interceptors, never multipliers — more planes than interceptors (saturation) get
      // through. Level II also shoots down conventional missiles, level III the strategic
      // warhead (the only counter to it) and warns of launches within twice its radius (2B.5).
      sam: {
        onCapture: "adopt",
        placement: "land",
        levels: [
          {
            name: "SAM Site",
            cost: 80_000,
            buildTicks: 100,
            range: 25,
            interceptors: 1,
            reloadTicks: 100,
          },
          {
            name: "Advanced SAM Site",
            cost: 180_000,
            buildTicks: 150,
            range: 35,
            interceptors: 2,
            reloadTicks: 80,
            interceptsMissiles: true,
          },
          {
            name: "Integrated Air Defense",
            cost: 400_000,
            buildTicks: 250,
            range: 45,
            interceptors: 3,
            reloadTicks: 60,
            interceptsMissiles: true,
            interceptsWarheads: true,
            earlyWarning: 2,
          },
        ],
      },
      // Missiles (§3.17.8, 2B.5): a late-game check on a leader. The strike missile (75k a
      // launch) costs every enemy building within 8 km a level; the bunker buster (II) two
      // levels of one building; the strategic warhead (III, 500k, 90 s) scorches 20 km. A
      // captured Silo is destroyed (too swingy to hand over). Slots reload one at a time.
      silo: {
        onCapture: "destroy",
        placement: "land",
        levels: [
          {
            name: "Missile Silo",
            cost: 250_000,
            buildTicks: 150,
            range: 250,
            missileSlots: 1,
            reloadTicks: 300,
          },
          {
            name: "Advanced Silo",
            cost: 400_000,
            buildTicks: 200,
            range: 400,
            missileSlots: 2,
            reloadTicks: 250,
            bunkerBuster: true,
          },
          {
            name: "Strategic Missile Complex",
            cost: 800_000,
            buildTicks: 300,
            wholeMap: true,
            missileSlots: 3,
            reloadTicks: 200,
            bunkerBuster: true,
            warheadCooldownTicks: 900,
          },
        ],
      },
    },
  },
  // Walls (§3.17.6, D-024). Hard tiles: an attack waits at each wall tile (3 / 6 / 10 s at
  // even odds, stretched or shortened like any tile by the attack's speed) and pays extra
  // troops, so fronts flow around the ends and through gaps. A 40-tile Palisade costs
  // 24k — about a Housing; a full Fortress Wall ~250k more.
  walls: {
    maxPoints: 12,
    maxTiles: 80,
    escalationTiles: 60,
    levels: [
      {
        name: "Palisade",
        costPerTile: 600,
        buildTicks: 40,
        buildTicksPerTile: 1,
        loss: 3,
        breakTroops: 150,
        holdTicks: 30,
      },
      {
        name: "Stone Wall",
        costPerTile: 1_500,
        buildTicks: 80,
        buildTicksPerTile: 1,
        loss: 5,
        breakTroops: 500,
        holdTicks: 60,
      },
      {
        name: "Fortress Wall",
        costPerTile: 4_000,
        buildTicks: 150,
        buildTicksPerTile: 2,
        loss: 8,
        breakTroops: 1_500,
        holdTicks: 100,
        // 3 km: a flight (2 tiles a tick) crossing the wall line is always seen inside it.
        flakRadius: 3,
      },
    ],
  },
  // Boats (§3.18): three at sea at once like OpenFront; 10 tiles/s, so a 100-tile crossing
  // takes 10 s — long enough to see it coming, short enough to matter. Ports add speed and
  // boats, up to 6 at sea.
  naval: {
    enabled: true,
    maxBoats: 3,
    maxBoatsWithPorts: 6,
    tilesPerTick: 1,
    landingSearchTiles: 60,
    maxRouteNodes: 600_000,
  },
  // Trade ships (§3.19, the user's request in 2.8): long routes pay more, capped. After the
  // Phase 2B playtest ("Ports don't make enough money when receiving goods early game") a
  // trip pays 1,000 + 12/tile (was 400 + 10), still at most 6,000: an early 80-tile route 1,960
  // to each side instead of 1,200, while long routes (capped) stay as they were.
  trade: {
    enabled: true,
    goldBase: 1_000,
    goldPerTile: 12,
    goldMax: 6_000,
    tilesPerTick: 1,
    maxShips: 200,
  },
  // Emojis and pings (§3.20, the user's choice at the 2.9 start: emojis + map pings, no quick
  // chat). Cooldowns like OpenFront's order of magnitude; a ping lasts long enough to act on.
  chat: {
    enabled: true,
    emojis: ["👋", "🤝", "👍", "👎", "😀", "😂", "😢", "😠", "😱", "💀", "🎯", "🙏", "❤️", "🏳️"],
    emoteCooldownTicks: 30,
    emoteShowTicks: 50,
    pingCooldownTicks: 10,
    pingTicks: 100,
    maxPingsPerPlayer: 3,
    pingAttackPreference: 3,
    pingDefendPreference: 3,
    pingMinGainFactor: 0.5,
    nationPingCooldownTicks: 300,
    nationHelpThreshold: 0.6,
    nationEmoteChance: 0.6,
  },
  // Flights (§3.17.7): transports 20 km/s, so an airlift across an Airport I range (250 km)
  // takes ~13 s and a missile across the whole reference map (~1,100 km) ~37 s — always
  // time to see it coming, never a teleport. Boats sail 10 km/s.
  flights: {
    transportTilesPerTick: 2,
    fighterTilesPerTick: 3,
    // Missiles 60 km/s (30 until the Phase 2B playtest: "missiles need to move faster"):
    // across the whole map in ~18 s, still long enough for SAMs to fire.
    missileTilesPerTick: 6,
    testFlights: false,
    testFlightPlanes: 4,
    enabled: true,
    airliftPlanes: 4,
    // An airdrop must stay a surprise or a second front, never a better ground attack.
    assaultPlanes: 4,
    airborneLoss: 1.25,
    // Four fighters: a lone SAM I can't stop a strike, a SAM III (3 interceptors) can only
    // blunt it to "disabled". Suppression opens a wall line for long enough to break it.
    strikePlanes: 4,
    strikeDamagePlanes: 2,
    strikeDisableTicks: 200,
    suppressionRadius: 10,
    suppressionTicks: 300,
    suppressedLoss: 0.8,
    // A strike missile costs about a Developed Housing: worth it against a cluster of
    // buildings, not against one. The warhead is a once-a-game decision for most players.
    // After the user's 2B.6 playtest ("missiles should destroy bases or suppress them, and
    // kill population too"): a strike missile costs buildings two levels (levels I–II are
    // destroyed) and puts the rest out of action for 60 s; a bunker buster destroys its target
    // outright (three levels); both kill a share of the victim's home troops.
    missileCost: 75_000,
    missileRadius: 8,
    missileLevels: 2,
    missileSuppressionTicks: 300,
    busterLevels: 3,
    missileDisableTicks: 600,
    missileTroopShare: 0.1,
    busterTroopShare: 0.05,
    // Splash (D-033): a 4 km crater for 30 s; a buster's blast costs neighbours a level.
    craterRadius: 4,
    craterTicks: 300,
    busterSplashRadius: 4,
    busterSplashLevels: 1,
    warheadCost: 500_000,
    warheadRadius: 20,
    scorchedTicks: 600,
    scorchedCost: 3,
  },
  // Warships (2B.6, D-031): faster than trade ships and Port I boats, as fast as a Naval
  // Port's, so they catch what sails through their patrol. Four shells sink a warship; a
  // troop boat sinks with one, so a Naval Base turns back a stream of small landings but
  // not a fleet launched at once (one shell every 2 s per warship).
  warships: {
    enabled: true,
    tilesPerTick: 1.5,
    hp: 1_000,
    shellDamage: 250,
    gunRange: 8,
    reloadTicks: 20,
    repathTicks: 10,
    rebuildTicks: 600,
    repairPerTick: 2,
    maxRouteNodes: 30_000,
    // The user after 2B.6: "warships need to be controlled by players" and "are too close to
    // shore" — a sent warship guards 15 km around its spot; patrol points stay 4 km offshore.
    orderRange: 15,
    offshore: 4,
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
  walls?: Partial<WallRules>;
  naval?: Partial<NavalRules>;
  trade?: Partial<TradeRules>;
  chat?: Partial<ChatRules>;
  flights?: Partial<FlightRules>;
  warships?: Partial<WarshipRules>;
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
    walls: { ...DEFAULT_RULES.walls, ...overrides.walls },
    naval: { ...DEFAULT_RULES.naval, ...overrides.naval },
    trade: { ...DEFAULT_RULES.trade, ...overrides.trade },
    chat: { ...DEFAULT_RULES.chat, ...overrides.chat },
    flights: { ...DEFAULT_RULES.flights, ...overrides.flights },
    warships: { ...DEFAULT_RULES.warships, ...overrides.warships },
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
