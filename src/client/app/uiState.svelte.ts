/**
 * The reactive state the Svelte UI reads. The session writes it at most once per tick
 * (ARCHITECTURE.md §6); components never change game state directly — they call the
 * session's actions.
 */
import type {
  AllianceRequestSnapshot,
  AllianceSnapshot,
  AttackSnapshot,
  BoatSnapshot,
  FlightSnapshot,
  TradeShipSnapshot,
  WarshipSnapshot,
  BuildingSnapshot,
  WallSnapshot,
  PlayerSnapshot,
  PingSnapshot,
} from "../../sim/frame.ts";
import { DEFAULT_SOUND, type SoundSettings } from "../audio/sound.ts";
import type { ThreatContext } from "./threats.ts";
import type { GameMap } from "../../sim/map/gameMap.ts";
import type { BoatContext, BoatPreview } from "./boats.ts";
import type { BuildContext, Placeable } from "./buildings.ts";
import type { LiftMode } from "./flights.ts";
import { alliesOf, type DiplomacyContext } from "./diplomacy.ts";
import type { DonationContext } from "./economy.ts";
import { DEFAULT_RULES } from "../../sim/rules.ts";
import type { Phase, PlayerId } from "../../sim/world.ts";
import { DEFAULT_ATTACK_PERCENT } from "./attackPercent.ts";
import type { HintId } from "./hints.ts";
import type { PreviewContext } from "./preview.ts";
import type { Difficulty } from "../../sim/rules.ts";
import {
  CLASSIC_MAP_SEED,
  DEFAULT_DIFFICULTY,
  DEFAULT_NATIONS,
  DEFAULT_TRIBES,
  type MapSize,
  type MapStyle,
} from "./setup.ts";
import { DEFAULT_TEAMS, type GameMode } from "./teams.ts";
import type { Toast } from "./toasts.ts";

export type Screen = "loading" | "start" | "lobby" | "game";

/** An online game (Phase 3): the lobby and the connection, shown by the lobby screen. */
export interface OnlineState {
  readonly status: "connecting" | "lobby" | "playing" | "error";
  readonly gameId: string;
  readonly players: readonly { readonly name: string; readonly connected: boolean }[];
  /** Your place in `players`. */
  readonly you: number;
  /** You created the game and may start it. */
  readonly creator: boolean;
  readonly error: string;
  /** This browser's game drifted from the server's (repair comes in 3.5). */
  readonly outOfSync: boolean;
}

/** Game speeds offered in the pause menu (solo games only). */
export const GAME_SPEEDS = [1, 2, 4] as const;

/** The open menu, if any: the pause menu, or the right-click menu for a tile. */
export type Menu =
  | { readonly kind: "pause" }
  | {
      readonly kind: "context";
      /** Where it opened, in CSS pixels. */
      readonly x: number;
      readonly y: number;
      readonly tile: number;
      readonly owner: PlayerId;
    }
  | {
      /** A building's card (GAME_DESIGN.md §3.17), or a wall's: opened by clicking it. */
      readonly kind: "building" | "wall";
      readonly x: number;
      readonly y: number;
      readonly id: number;
    };

/** The land tile under the mouse (null: none, or the card is hidden). */
export interface HoverInfo {
  readonly tile: number;
  readonly owner: PlayerId;
  /** 1 plains · 2 highland · 3 mountain. */
  readonly terrain: number;
  readonly x: number;
  readonly y: number;
}

class UiState {
  screen = $state<Screen>("loading");
  fatalError = $state<string | null>(null);
  /** Start-screen choices (kept across games; pure UI choices like the attack %). */
  nations = $state(DEFAULT_NATIONS);
  tribes = $state(DEFAULT_TRIBES);
  difficulty = $state<Difficulty>(DEFAULT_DIFFICULTY);
  mapSize = $state<MapSize>("normal");
  /** Map type and which map (2.8): the classic map until 🎲 rolls another. */
  mapStyle = $state<MapStyle>("continent");
  mapSeed = $state(CLASSIC_MAP_SEED);
  /** A new map is being generated (the start screen waits to offer Play). */
  mapLoading = $state(false);
  /** Free-for-all or teams, and how many teams (GAME_DESIGN.md §3.15). */
  mode = $state<GameMode>("ffa");
  teams = $state(DEFAULT_TEAMS);
  phase = $state<Phase>("spawn");
  tick = $state(0);
  playStartTick = $state(-1);
  localPlayerId = $state<PlayerId>(0);
  /** Total land tiles on the map (for land %). */
  landTiles = $state(1);
  /** Colors by player id. */
  colors = $state.raw<readonly string[]>([]);
  players = $state.raw<readonly PlayerSnapshot[]>([]);
  attacks = $state.raw<readonly AttackSnapshot[]>([]);
  alliances = $state.raw<readonly AllianceSnapshot[]>([]);
  allianceRequests = $state.raw<readonly AllianceRequestSnapshot[]>([]);
  buildings = $state.raw<readonly BuildingSnapshot[]>([]);
  walls = $state.raw<readonly WallSnapshot[]>([]);
  /** Boats at sea (GAME_DESIGN.md §3.18). */
  boats = $state.raw<readonly BoatSnapshot[]>([]);
  /** Trade ships at sea (GAME_DESIGN.md §3.19). */
  tradeShips = $state.raw<readonly TradeShipSnapshot[]>([]);
  /** Flights in the air (GAME_DESIGN.md §3.17.7). */
  flights = $state.raw<readonly FlightSnapshot[]>([]);
  /** Warships (2B.6), sunk ones in their shipyard too. */
  warships = $state.raw<readonly WarshipSnapshot[]>([]);
  /** Map pings the local player sees: theirs and their friends' (GAME_DESIGN.md §3.20). */
  pings = $state.raw<readonly PingSnapshot[]>([]);
  /** Tick of the local player's last emoji and ping (-1 = none), for the menu's cooldowns. */
  myLastEmoteTick = $state(-1);
  myLastPingTick = $state(-1);
  /** Alert sound settings (kept across games, remembered by the browser). */
  sound = $state.raw<SoundSettings>(DEFAULT_SOUND);
  /** The crossing a click on the hovered land would start (null: the click isn't a boat). */
  boatPreview = $state.raw<BoatPreview | null>(null);
  /** The building picked up from the build bar, following the mouse until placed. */
  placing = $state<Placeable | null>(null);
  /**
   * The Airport whose airlift (or airborne assault, `liftMode`) target is being chosen
   * (GAME_DESIGN.md §3.17.7), or null.
   */
  airliftFrom = $state<number | null>(null);
  liftMode = $state<LiftMode>("airlift");
  /**
   * Aiming from the command bar's missile launcher (D-033): each click fires from whichever
   * Silo can, and aiming goes on while missiles are ready (airliftFrom is then any such Silo).
   */
  missileAuto = $state(false);
  /** Your warship selected for orders: the next click on the sea sends it there (or null). */
  selectedWarship = $state<number | null>(null);
  /** The air defence view (GAME_DESIGN.md §3.17.7, key V): every SAM's ring on the map. */
  airDefense = $state(false);
  /** The wall being drawn: the corner points placed so far (GAME_DESIGN.md §3.17.6). */
  wallPoints = $state.raw<readonly number[]>([]);
  /**
   * The map and the client's copy of tile ownership (not reactive: the HUD reads them when
   * something reactive — the tick, the menu — changes).
   */
  map: GameMap | null = null;
  owner: Uint16Array = new Uint16Array(0);
  /** The client's copy of the Border Defense level per tile (GAME_DESIGN.md §3.17.6). */
  fort: Uint8Array = new Uint8Array(0);
  /** Coast tiles a Naval Base fortifies (2B.6), with their wall level; refreshed every frame. */
  coastForts = $state.raw<ReadonlyMap<number, number>>(new Map());
  /** Tick of the local player's last alliance request to each player (for the cooldown). */
  myRequests = $state.raw<ReadonlyMap<PlayerId, number>>(new Map());
  /** Tick of the local player's last donation to each friend, by donationKeyOf(to, resource). */
  myDonations = $state.raw<ReadonlyMap<string, number>>(new Map());
  /** Allies whose renewal prompt the local player closed with "Let it end". */
  dismissedRenewals = $state.raw<ReadonlySet<PlayerId>>(new Set());
  /** Share of home troops a click sends (client-side choice; sent with each command). */
  attackPercent = $state(DEFAULT_ATTACK_PERCENT);
  winner = $state<PlayerId | null>(null);
  /** Team games: the team that won (0 = none). */
  winningTeam = $state(0);
  gameOverReason = $state<"landShare" | "lastStanding" | "noneLeft" | null>(null);
  /** Who eliminated the local player (null: nobody / not eliminated). */
  eliminatedBy = $state<PlayerId | null>(null);
  /** The local player closed the "you were eliminated" card to keep watching. */
  spectating = $state(false);
  /** Biggest size each attack had (attack id → troops), for the chips' shrinking bars. */
  attackPeak = $state.raw<ReadonlyMap<number, number>>(new Map());
  menu = $state.raw<Menu | null>(null);
  paused = $state(false);
  /** Game speed multiplier (solo games). */
  speed = $state(1);
  hover = $state.raw<HoverInfo | null>(null);
  /** Set while in an online lobby or game; null in solo games. */
  online = $state.raw<OnlineState | null>(null);
  toasts = $state.raw<readonly Toast[]>([]);
  hint = $state<HintId | null>(null);

  /** Back to a clean slate for a new game. */
  reset(): void {
    this.phase = "spawn";
    this.tick = 0;
    this.playStartTick = -1;
    this.players = [];
    this.attacks = [];
    this.alliances = [];
    this.allianceRequests = [];
    this.buildings = [];
    this.walls = [];
    this.boats = [];
    this.tradeShips = [];
    this.flights = [];
    this.warships = [];
    this.pings = [];
    this.myLastEmoteTick = -1;
    this.myLastPingTick = -1;
    this.boatPreview = null;
    this.placing = null;
    this.airliftFrom = null;
    this.missileAuto = false;
    this.selectedWarship = null;
    this.wallPoints = [];
    this.myRequests = new Map();
    this.myDonations = new Map();
    this.dismissedRenewals = new Set();
    this.winner = null;
    this.winningTeam = 0;
    this.gameOverReason = null;
    this.eliminatedBy = null;
    this.spectating = false;
    this.attackPeak = new Map();
    this.menu = null;
    this.paused = false;
    this.speed = 1;
    this.hover = null;
    this.toasts = [];
    this.hint = null;
  }

  get me(): PlayerSnapshot | undefined {
    return this.players[this.localPlayerId - 1];
  }

  /** What the battle preview needs (Phase 1 always plays with the default rules). */
  get previewContext(): PreviewContext {
    return {
      rules: DEFAULT_RULES,
      phase: this.phase,
      tick: this.tick,
      playStartTick: this.playStartTick,
      me: this.me,
      players: this.players,
      allies: this.allies,
      teammates: this.teammates,
      fort: this.fort,
      coastForts: this.coastForts,
    };
  }

  /** What the diplomacy HUD needs (GAME_DESIGN.md §3.14). */
  get diplomacyContext(): DiplomacyContext {
    return {
      rules: DEFAULT_RULES,
      phase: this.phase,
      tick: this.tick,
      me: this.me,
      players: this.players,
      alliances: this.alliances,
      requests: this.allianceRequests,
      myRequests: this.myRequests,
    };
  }

  /** What the donation options need (GAME_DESIGN.md §3.16). */
  get donationContext(): DonationContext {
    return { rules: DEFAULT_RULES, tick: this.tick, me: this.me, myDonations: this.myDonations };
  }

  /** What the build menu and building cards need (GAME_DESIGN.md §3.17). */
  get buildContext(): BuildContext {
    return {
      rules: DEFAULT_RULES,
      map: this.map,
      owner: this.owner,
      buildings: this.buildings,
      walls: this.walls,
      warships: this.warships,
      me: this.me,
      tick: this.tick,
      playing: this.phase === "playing",
    };
  }

  /** What the boat HUD needs (GAME_DESIGN.md §3.18). */
  get boatContext(): BoatContext {
    return {
      rules: DEFAULT_RULES,
      map: this.map,
      owner: this.owner,
      buildings: this.buildings,
      boats: this.boats,
      me: this.me,
      tick: this.tick,
      playing: this.phase === "playing",
    };
  }

  /** What the incoming-threat warning needs (GAME_DESIGN.md §3.20). */
  get threatContext(): ThreatContext {
    return {
      rules: DEFAULT_RULES,
      owner: this.owner,
      boats: this.boats,
      flights: this.flights,
      buildings: this.buildings,
      friends: this.friends,
      me: this.me?.alive ? this.localPlayerId : 0,
      tick: this.tick,
      width: this.map?.width ?? 0,
    };
  }

  /** The local player's allies. */
  get allies(): Set<PlayerId> {
    return alliesOf(this.alliances, this.localPlayerId);
  }

  /** The local player's teammates (empty in free-for-all games). */
  get teammates(): Set<PlayerId> {
    const team = this.me?.team ?? 0;
    const mates = new Set<PlayerId>();
    if (team === 0) return mates;
    for (const p of this.players)
      if (p.team === team && p.id !== this.localPlayerId) mates.add(p.id);
    return mates;
  }

  /** Allies and teammates: friendly players (mint names and borders). */
  get friends(): Set<PlayerId> {
    const friends = this.teammates;
    for (const id of this.allies) friends.add(id);
    return friends;
  }

  /** A team game is running (GAME_DESIGN.md §3.15). */
  get teamGame(): boolean {
    return this.players.some((p) => p.team !== 0);
  }

  isTraitor(id: PlayerId): boolean {
    return (this.players[id - 1]?.traitorUntilTick ?? -1) > this.tick;
  }

  colorOf(id: PlayerId): string {
    return id === 0 ? "#9aa5b4" : (this.colors[id] ?? "#888");
  }

  playerName(id: PlayerId): string {
    return id === 0 ? "Neutral land" : (this.players[id - 1]?.name ?? `Player ${id}`);
  }
}

export const ui = new UiState();
