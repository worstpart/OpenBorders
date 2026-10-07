/**
 * The game client: wires host ↔ renderer ↔ camera ↔ input ↔ UI state, and runs the
 * animation-frame loop. Rules live in the simulation; this file only translates.
 */
import { LocalHost } from "../../host/localHost.ts";
import type { FrameTiming } from "../../host/host.ts";
import type { Command } from "../../sim/commands.ts";
import type { TickFrame } from "../../sim/frame.ts";
import { isLand, tileAt, type GameMap } from "../../sim/map/gameMap.ts";
import { generateContinent } from "../../sim/map/generate.ts";
import { coastTiles, landmassesOf, seasOf } from "../../sim/systems/naval.ts";
import { BoatLayer } from "../render/boats.ts";
import { BOAT_PREVIEW_TEXT, boatPreview, needsBoat } from "./boats.ts";
import type { DonationResource, PlayerSetup } from "../../sim/world.ts";
import type { BuildingType } from "../../sim/rules.ts";
import {
  BuildingLayer,
  iconSize,
  ICON_MIN_PX,
  ICON_PX_PER_ZOOM,
  type BuildGhost,
} from "../render/buildings.ts";
import {
  BUILD_BLOCK_TEXT,
  buildingAtPoint,
  placementCheck,
  WALL_PREVIEW_TEXT,
  wallAtPoint,
  wallPreview,
  type Placeable,
  type WallPreview,
} from "./buildings.ts";
import { Camera } from "../camera/camera.ts";
import { Controls, type KeyAction, type ScreenPoint } from "../input/controls.ts";
import {
  computeLabelPlacements,
  LabelLayer,
  type LabelPlacement,
  type LootFloater,
} from "../render/labels.ts";
import { PerfOverlay } from "../render/perfOverlay.ts";
import { MapRenderer } from "../render/renderer.ts";
import { DEFAULT_RULES, type Difficulty } from "../../sim/rules.ts";
import { presetPercent, stepPercent } from "./attackPercent.ts";
import { allianceStatus, diplomacyCards } from "./diplomacy.ts";
import { donationKeyOf, MOBILIZE_PERCENT, mobilizePreview } from "./economy.ts";
import { nearestOwnedTile } from "./focus.ts";
import { HintTracker, localHintStore, type HintId } from "./hints.ts";
import { pickBotNames, pickNationNames, playerColors, teamPlayerColors } from "./players.ts";
import { protectionSecondsLeft } from "./preview.ts";
import { MAP_SIZES, type MapSize } from "./setup.ts";
import {
  addToast,
  BIG_LOBBY_PLAYERS,
  TOAST_MS,
  toastsForEvents,
  type ToastInput,
} from "./toasts.ts";
import { dealTeam, teamName, teamsKnockedOut, type GameMode } from "./teams.ts";
import { ui } from "./uiState.svelte.ts";

/** One fixed procedural continent, in two sizes (setup.ts). */
export const MAP_SEED = 2;
const LOCAL_PLAYER_ID = 1;
/** Label positions are recomputed at most this often while territory changes. */
const LABEL_REFRESH_MS = 250;
/** The mouse rests this long on far land before its boat route is planned (a search each). */
const BOAT_PREVIEW_REST_MS = 120;
/** The gold capture effect (GAME_DESIGN.md §3.16) lasts this long, in real time. */
const LOOT_FX_MS = 2_400;

/** A capture whose gold is pouring into the capturer (border shimmer + floating number). */
interface LootEffect {
  readonly capturer: number;
  readonly x: number;
  readonly y: number;
  readonly gold: number;
  readonly start: number;
}

export interface ClientElements {
  mapCanvas: HTMLCanvasElement;
  labelCanvas: HTMLCanvasElement;
  overlayParent: HTMLElement;
  fontFamily: string;
}

export class GameClient {
  private readonly renderer: MapRenderer;
  private readonly labels: LabelLayer;
  private readonly buildingLayer: BuildingLayer;
  private readonly boatLayer: BoatLayer;
  /** The hovered tile the boat preview was computed for, and when (route searches cost). */
  private boatPreviewTile = -1;
  private boatPreviewAt = 0;
  /** The tile under the mouse and since when (the preview waits until the mouse rests). */
  private hoverTile = -1;
  private hoverSince = 0;
  private readonly camera = new Camera();
  private readonly perf: PerfOverlay;
  private readonly controls: Controls;
  private readonly mapCanvas: HTMLCanvasElement;

  private map: GameMap | null = null;
  private host: LocalHost | null = null;
  /** Client-side copy of tile ownership, updated from tick frames. */
  private owner = new Uint16Array(0);
  private placements = new Map<number, LabelPlacement>();
  private labelsDirty = false;
  private lastLabelRefresh = 0;
  private latestFrame: TickFrame | null = null;
  private hoverPoint: ScreenPoint | null = null;
  private lastFrameTime = performance.now();
  private readonly hints = new HintTracker(localHintStore);
  private nextToastId = 1;
  /** Player flags from the latest frame (ally, traitor); loot effects are added per frame. */
  private baseFlags: Uint8Array = new Uint8Array(1);
  private lootEffects: LootEffect[] = [];

  constructor(elements: ClientElements) {
    this.mapCanvas = elements.mapCanvas;
    this.renderer = new MapRenderer(elements.mapCanvas);
    this.labels = new LabelLayer(elements.labelCanvas, elements.fontFamily);
    this.buildingLayer = new BuildingLayer(elements.labelCanvas);
    this.boatLayer = new BoatLayer(elements.labelCanvas, elements.fontFamily);
    this.perf = new PerfOverlay(elements.overlayParent);
    this.controls = new Controls(elements.mapCanvas, {
      primaryClick: (at) => this.primaryClick(at),
      secondaryClick: (at) => this.secondaryClick(at),
      menuOpen: () => ui.menu !== null,
      pan: (dx, dy) => this.camera.panBy(dx, dy),
      zoom: (factor, anchor) => this.camera.zoomAt(factor, anchor),
      hover: (at) => (this.hoverPoint = at),
      key: (action) => this.key(action),
      adjustPercent: (steps) => (ui.attackPercent = stepPercent(ui.attackPercent, steps)),
    });
    new ResizeObserver(() => this.resize()).observe(elements.mapCanvas);
    this.resize();
    requestAnimationFrame((time) => this.animationFrame(time));
  }

  /** Generates the map of the chosen size and shows it behind the start screen. */
  loadMap(size: MapSize): void {
    const { width, height } = MAP_SIZES[size];
    const map =
      this.map?.width === width && this.map.height === height
        ? this.map
        : generateContinent({ seed: MAP_SEED, width, height });
    this.map = map;
    // The sea data boats need, computed now rather than at the first boat (a short hitch).
    seasOf(map);
    coastTiles(map);
    landmassesOf(map);
    this.owner = new Uint16Array(map.width * map.height);
    ui.map = map;
    ui.owner = this.owner;
    ui.fort = new Uint8Array(this.owner.length);
    this.renderer.setMap(map, this.owner);
    this.renderer.setPlayerColors(["#000000"]);
    this.camera.setMap(map.width, map.height);
    this.placements.clear();
    ui.landTiles = map.landTiles;
    ui.screen = "start";
  }

  /**
   * Starts a single-player game against nations and tribes (GAME_DESIGN.md §3.13), free
   * for all or in teams (§3.15: you and the nations dealt round-robin; tribes teamless).
   */
  async startGame(lobby: {
    nations: number;
    tribes: number;
    difficulty: Difficulty;
    mode: GameMode;
    teams: number;
  }): Promise<void> {
    const map = this.map;
    if (!map) throw new Error("startGame() before loadMap()");
    this.host?.dispose();

    const random = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
    const teams = lobby.mode === "teams" ? lobby.teams : 0;
    const players: PlayerSetup[] = [
      { name: "You", kind: "human", team: teams > 0 ? dealTeam(0, teams) : 0 },
      ...pickNationNames(lobby.nations, random).map((name, k) => ({
        name,
        kind: "bot" as const,
        tier: "nation" as const,
        difficulty: lobby.difficulty,
        team: teams > 0 ? dealTeam(k + 1, teams) : 0,
      })),
      ...pickBotNames(lobby.tribes, random).map((name) => ({
        name,
        kind: "bot" as const,
        tier: "tribe" as const,
      })),
    ];
    const tiers = players.map((p) => (p.kind === "human" ? "human" : (p.tier ?? "nation")));
    const colors =
      teams > 0
        ? teamPlayerColors(players.map((p, k) => ({ tier: tiers[k]!, team: p.team ?? 0 })))
        : playerColors(tiers);
    const host = new LocalHost({ localPlayerId: LOCAL_PLAYER_ID });
    this.host = host;
    host.onFrame((frame, timing) => this.onFrame(frame, timing));
    const initial = await host.start({ seed: Math.floor(random() * 2 ** 32), map, players });

    this.owner = initial.owner.slice();
    ui.map = initial.map;
    ui.owner = this.owner;
    ui.fort = new Uint8Array(this.owner.length);
    this.renderer.setMap(initial.map, this.owner);
    this.renderer.setPlayerColors(colors);
    this.renderer.setLocalOwner(initial.localPlayerId);
    this.placements.clear();
    this.latestFrame = initial.frame;
    ui.reset();
    ui.colors = colors;
    ui.localPlayerId = initial.localPlayerId;
    this.publish(initial.frame);
    ui.screen = "game";
  }

  /**
   * Development-only hooks for verifying behavior from the browser console (exposed as
   * window.__openborder by main.ts in dev builds only): slow the game down, pause it,
   * and read the latest tick frame.
   */
  get debug() {
    return {
      setSpeed: (multiplier: number) => this.setSpeed(multiplier),
      pause: () => this.host?.pause(),
      resume: () => this.host?.resume(),
      frame: () => this.latestFrame,
      renderer: () => this.renderer,
      /** Sends a command as the local player (scripted browser checks). */
      send: (command: Command) => this.host?.send(command),
      /** Sends a command as another player (e.g. a bot asking us for an alliance). */
      sendAs: (playerId: number, command: Command) => this.host?.sendAs(playerId, command),
      /** Where a tile's centre is on screen (CSS pixels), for scripted clicks. */
      screenOf: (tile: number) => {
        const width = this.map?.width ?? 1;
        return this.camera.worldToScreen({
          x: (tile % width) + 0.5,
          y: Math.floor(tile / width) + 0.5,
        });
      },
      /** Centres the camera on a tile, zoomed `factor` times from the current zoom. */
      look: (tile: number, factor = 1) => {
        if (!this.map) return;
        this.camera.focusOn({
          x: (tile % this.map.width) + 0.5,
          y: Math.floor(tile / this.map.width) + 0.5,
        });
        const size = this.camera.viewportSize;
        this.camera.zoomAt(factor, { x: size.x / 2, y: size.y / 2 });
      },
    };
  }

  /** Asks `target` for an alliance (or accepts their request). */
  requestAlliance(target: number): void {
    this.host?.send({ type: "allianceRequest", target });
  }

  replyAlliance(from: number, accept: boolean): void {
    this.host?.send({ type: "allianceReply", from, accept });
  }

  renewAlliance(ally: number): void {
    this.host?.send({ type: "allianceRenew", ally });
  }

  breakAlliance(ally: number): void {
    this.host?.send({ type: "allianceBreak", ally });
  }

  /** Dismisses a renewal prompt without renewing (the alliance just runs out). */
  dismissRenewal(ally: number): void {
    const dismissed = new Set(ui.dismissedRenewals);
    dismissed.add(ally);
    ui.dismissedRenewals = dismissed;
  }

  /** Turns gold into troops: one click buys MOBILIZE_PERCENT of the capacity. */
  mobilize(): void {
    if (ui.screen !== "game" || ui.phase !== "playing" || !ui.me?.alive) return;
    this.host?.send({ type: "mobilize", percentBp: MOBILIZE_PERCENT * 100 });
  }

  /** Gives a friend `percent`% of our home troops or gold. */
  donate(to: number, resource: DonationResource, percent: number): void {
    this.host?.send({ type: "donate", to, resource, percentBp: Math.round(percent * 100) });
  }

  /**
   * Picks a building up from the build bar (GAME_DESIGN.md §3.17.13): it follows the mouse
   * until a click on our land places it. Picking the same one again puts it back.
   */
  pickBuilding(type: Placeable): void {
    if (ui.screen !== "game" || ui.phase !== "playing" || !ui.me?.alive) return;
    ui.placing = ui.placing === type ? null : type;
    ui.wallPoints = [];
    if (ui.placing) ui.menu = null;
  }

  upgrade(buildingId: number): void {
    this.host?.send({ type: "upgrade", buildingId });
  }

  cancelBuild(buildingId: number): void {
    this.host?.send({ type: "cancelBuild", buildingId });
  }

  upgradeWall(wallId: number): void {
    this.host?.send({ type: "upgradeWall", wallId });
  }

  cancelWall(wallId: number): void {
    this.host?.send({ type: "cancelWall", wallId });
  }

  /**
   * Drawing a wall (GAME_DESIGN.md §3.17.6): each click adds a corner point (A, B, C …);
   * a click on the last point again, right-click or Enter finishes.
   */
  private addWallPoint(tile: number): void {
    const points = ui.wallPoints;
    if (points.at(-1) === tile) {
      this.finishWall();
      return;
    }
    const preview = wallPreview(ui.buildContext, [...points, tile], null);
    if (preview?.problem && preview.problem !== "noGold") {
      this.toast({ text: `Can't wall there: ${WALL_PREVIEW_TEXT[preview.problem]}`, tone: "info" });
      return;
    }
    ui.wallPoints = [...points, tile];
    if (ui.wallPoints.length >= DEFAULT_RULES.walls.maxPoints) this.finishWall();
  }

  /** Builds the wall drawn so far, or puts the tool back if fewer than two points. */
  private finishWall(): void {
    const points = ui.wallPoints;
    if (points.length < 2) {
      ui.placing = null;
      ui.wallPoints = [];
      return;
    }
    const preview = wallPreview(ui.buildContext, points, null);
    if (preview?.problem) {
      this.toast({
        text: `Can't build the wall: ${WALL_PREVIEW_TEXT[preview.problem]}`,
        tone: "info",
      });
      return;
    }
    this.host?.send({ type: "buildWall", points: [...points] });
    ui.placing = null;
    ui.wallPoints = [];
  }

  retreat(attackId: number): void {
    this.host?.send({ type: "retreat", attackId });
  }

  /** Retreats every attack of ours on `target`. */
  retreatFrom(target: number): void {
    for (const attack of ui.attacks) {
      if (attack.attacker === ui.localPlayerId && attack.target === target && !attack.retreating) {
        this.retreat(attack.id);
      }
    }
  }

  /**
   * Attacks (or expands into) the land at `tile` with `percent`% of our home troops. Land
   * we can't reach over our own border gets a boat instead (GAME_DESIGN.md §3.18).
   */
  attackTile(tile: number, percent: number): void {
    const me = ui.me;
    if (!this.host || !this.map || ui.phase !== "playing" || !me?.alive) return;
    if (!isLand(this.map, tile)) return;
    const target = this.owner[tile]!;
    if (target === me.id) return;
    if (needsBoat(ui.boatContext, tile) && !ui.friends.has(target)) {
      this.sendBoat(tile, percent);
      return;
    }
    // Neutral land → expand; enemy land → attack. The simulation validates the rest.
    this.host.send({
      type: "attack",
      target,
      focusTile: tile,
      percentBp: Math.round(percent * 100),
    });
  }

  /**
   * Sends a boat with `percent`% of our home troops to the coast nearest `tile` (also from
   * the right-click menu, even where we border them by land).
   */
  sendBoat(tile: number, percent: number): void {
    const me = ui.me;
    if (!this.host || !this.map || ui.phase !== "playing" || !me?.alive) return;
    const target = this.owner[tile]!;
    if (target === me.id || !isLand(this.map, tile)) return;
    const preview = boatPreview({ ...ui.boatContext, me: { ...me, neighbors: [] } }, tile);
    if (preview?.problem) {
      this.toast({ text: `No boat: ${BOAT_PREVIEW_TEXT[preview.problem]}`, tone: "info" });
      return;
    }
    this.host.send({ type: "boat", target, tile, percentBp: Math.round(percent * 100) });
    this.hints.complete(target === 0 ? "expand" : "attack");
  }

  /** Turns one of our boats around. */
  recallBoat(boatId: number): void {
    this.host?.send({ type: "recallBoat", boatId });
  }

  /**
   * Answers an incoming attack by attacking its sender with the current percentage, aimed
   * at their land nearest to where they attack: opposing armies cancel out first.
   */
  counter(attackId: number): void {
    const attack = ui.attacks.find((a) => a.id === attackId);
    const map = this.map;
    if (!attack || !map) return;
    const tile = nearestOwnedTile(
      this.owner,
      map.width,
      map.height,
      attack.focusTile,
      attack.attacker,
    );
    if (tile >= 0) this.attackTile(tile, ui.attackPercent);
  }

  /** Opens the pause menu and stops the clock (solo games). */
  pause(): void {
    if (ui.screen !== "game") return;
    this.host?.pause();
    ui.paused = true;
    ui.menu = { kind: "pause" };
  }

  /** Closes whatever menu is open; leaving the pause menu resumes the game. */
  closeMenu(): void {
    if (ui.menu?.kind === "pause") {
      this.host?.resume();
      ui.paused = false;
    }
    ui.menu = null;
  }

  setSpeed(multiplier: number): void {
    this.host?.setSpeed(multiplier);
    ui.speed = multiplier;
  }

  dismissHint(id: HintId): void {
    this.hints.complete(id);
  }

  /** Ends the current game and returns to the start screen (the map stays). */
  backToStart(): void {
    this.host?.dispose();
    this.host = null;
    this.latestFrame = null;
    if (this.map) {
      this.owner = new Uint16Array(this.map.width * this.map.height);
      ui.owner = this.owner;
      ui.fort = new Uint8Array(this.owner.length);
      this.renderer.setMap(this.map, this.owner);
    }
    this.renderer.setAttacks([], 0);
    this.renderer.setHoverOwner(0);
    this.boatPreviewTile = -1;
    this.placements.clear();
    this.lootEffects = [];
    this.baseFlags = new Uint8Array(1);
    ui.reset();
    ui.screen = "start";
  }

  confirmSpawn(): void {
    const me = ui.me;
    if (ui.screen === "game" && ui.phase === "spawn" && me?.spawned && !me.ready) {
      this.host?.send({ type: "confirmSpawn" });
    }
  }

  private onFrame(frame: TickFrame, timing: FrameTiming): void {
    this.perf.recordTick(timing.tickMs);
    this.latestFrame = frame;
    if (frame.changedTiles.length > 0) {
      for (let k = 0; k < frame.changedTiles.length; k++) {
        this.owner[frame.changedTiles[k]!] = frame.changedOwners[k]!;
      }
      this.renderer.applyTileChanges(frame.changedTiles, frame.changedOwners, frame.tick);
      this.labelsDirty = true;
    }
    if (frame.fortTiles.length > 0) {
      for (let k = 0; k < frame.fortTiles.length; k++) {
        ui.fort[frame.fortTiles[k]!] = frame.fortLevels[k]!;
      }
    }
    const me = ui.localPlayerId;
    for (const event of frame.events) {
      if (event.type === "commandRejected" && event.playerId === me) {
        console.info(`Command "${event.command}" rejected: ${event.reason}`);
      } else if (event.type === "attackStarted" && event.attacker === me) {
        this.hints.complete(event.target === 0 ? "expand" : "attack");
      } else if (event.type === "allianceRequested" && event.from === me) {
        const sent = new Map(ui.myRequests);
        sent.set(event.to, frame.tick);
        ui.myRequests = sent;
        this.hints.complete("ally");
      } else if (
        (event.type === "allianceRenewed" || event.type === "allianceEnded") &&
        (event.a === me || event.b === me)
      ) {
        // A new renewal window may come later: forget an earlier "let it end".
        const ally = event.a === me ? event.b : event.a;
        if (ui.dismissedRenewals.has(ally)) {
          const dismissed = new Set(ui.dismissedRenewals);
          dismissed.delete(ally);
          ui.dismissedRenewals = dismissed;
        }
      } else if (event.type === "donated" && event.from === me) {
        const sent = new Map(ui.myDonations);
        sent.set(donationKeyOf(event.to, event.resource), frame.tick);
        ui.myDonations = sent;
      } else if (event.type === "mobilized" && event.playerId === me) {
        this.hints.complete("gold");
      } else if (event.type === "buildingStarted" && event.playerId === me) {
        this.hints.complete("build");
      } else if (event.type === "eliminated" && event.playerId === ui.localPlayerId) {
        ui.eliminatedBy = event.by;
      }
      if (event.type === "eliminated" && event.by !== null && event.loot >= 1) {
        // Labels refresh lazily, so the captured player's last label spot is still known.
        const place = this.placements.get(event.playerId);
        if (place) {
          this.lootEffects.push({
            capturer: event.by,
            x: place.x,
            y: place.y,
            gold: event.loot,
            start: performance.now(),
          });
        }
      } else if (event.type === "gameOver") {
        ui.winner = event.winner;
        ui.winningTeam = event.team;
        ui.gameOverReason = event.reason;
      }
    }
    // ui.me still holds last tick's snapshot here: who bordered us before this tick.
    const bordered = ui.me?.neighbors ?? [];
    const bigLobby = frame.players.length > BIG_LOBBY_PLAYERS;
    const toasts = toastsForEvents(
      frame.events,
      me,
      (id) => ui.playerName(id),
      (id) => !bigLobby || bordered.includes(id),
      (id) => frame.players[id - 1]?.team ?? 0,
    );
    // Team games: a team whose last member just went out (ui.players is still last tick's).
    for (const team of teamsKnockedOut(ui.players, frame.players)) {
      const mine = team === frame.players[me - 1]?.team;
      toasts.push({
        text: mine ? "Your team has been knocked out" : `${teamName(team)} is out`,
        tone: mine ? "danger" : "success",
      });
    }
    const protectionEnd = frame.playStartTick + DEFAULT_RULES.spawn.protectionTicks;
    if (frame.phase === "playing" && frame.tick === protectionEnd) {
      toasts.push({
        text: "Spawn protection is over — players can attack each other",
        tone: "info",
      });
    }
    const victory = DEFAULT_RULES.victory;
    if (
      frame.phase === "playing" &&
      frame.tick === frame.playStartTick + victory.declineStartTicks
    ) {
      toasts.push({
        text:
          `Long game: the land needed to win now drops ${victory.declineStep * 100}% ` +
          `every ${victory.declineStepTicks / 10} s, down to ${victory.minLandShare * 100}%`,
        tone: "info",
      });
    }
    for (const toast of toasts) this.toast(toast);
    this.publish(frame);
  }

  private toast(input: ToastInput): void {
    const id = this.nextToastId++;
    ui.toasts = addToast(ui.toasts, { ...input, id });
    setTimeout(() => (ui.toasts = ui.toasts.filter((t) => t.id !== id)), TOAST_MS);
  }

  /** Copies what the UI needs from a frame into the reactive UI state. */
  private publish(frame: TickFrame): void {
    ui.tick = frame.tick;
    ui.phase = frame.phase;
    ui.playStartTick = frame.playStartTick;
    ui.players = frame.players;
    ui.attacks = frame.attacks;
    ui.alliances = frame.alliances;
    ui.allianceRequests = frame.allianceRequests;
    ui.buildings = frame.buildings;
    ui.walls = frame.walls;
    ui.boats = frame.boats;
    if (ui.placing && (frame.phase !== "playing" || !frame.players[ui.localPlayerId - 1]?.alive)) {
      ui.placing = null;
    }
    // A building card whose building is gone closes.
    const menu = ui.menu;
    if (
      (menu?.kind === "building" && !frame.buildings.some((b) => b.id === menu.id)) ||
      (menu?.kind === "wall" && !frame.walls.some((w) => w.id === menu.id))
    ) {
      ui.menu = null;
    }
    const peaks = new Map<number, number>();
    for (const attack of frame.attacks) {
      peaks.set(attack.id, Math.max(attack.troops, ui.attackPeak.get(attack.id) ?? 0));
    }
    ui.attackPeak = peaks;
    this.renderer.setAttacks(frame.attacks, frame.players.length);
    this.baseFlags = this.playerFlags(frame);
  }

  /**
   * The player flags for this animation frame: the frame's ally/traitor bits plus the
   * strength of each running gold capture effect in bits 2–7 (a quick rise, then a fade).
   */
  private animatedFlags(now: number): Uint8Array {
    this.lootEffects = this.lootEffects.filter((e) => now - e.start < LOOT_FX_MS);
    if (this.lootEffects.length === 0) return this.baseFlags;
    const flags = this.baseFlags.slice();
    for (const effect of this.lootEffects) {
      if (effect.capturer >= flags.length) continue;
      const age = (now - effect.start) / LOOT_FX_MS;
      const strength = Math.min(1, age * 8) * (1 - age);
      const level = Math.round(63 * strength);
      if (level > flags[effect.capturer]! >> 2) {
        flags[effect.capturer] = (flags[effect.capturer]! & 3) | (level << 2);
      }
    }
    return flags;
  }

  private lootFloaters(now: number): LootFloater[] {
    return this.lootEffects.map((e) => ({
      x: e.x,
      y: e.y,
      gold: e.gold,
      age: Math.min(1, (now - e.start) / LOOT_FX_MS),
      mine: e.capturer === ui.localPlayerId,
    }));
  }

  /**
   * Per player id: 1 = friendly to the local player (an ally or a teammate), 2 = traitor
   * (map markers, §3.14–3.15).
   */
  private playerFlags(frame: TickFrame): Uint8Array {
    const flags = new Uint8Array(frame.players.length + 1);
    const me = ui.localPlayerId;
    const myTeam = frame.players[me - 1]?.team ?? 0;
    if (myTeam !== 0) {
      for (const p of frame.players) if (p.id !== me && p.team === myTeam) flags[p.id]! |= 1;
    }
    for (const a of frame.alliances) {
      if (a.a === me) flags[a.b]! |= 1;
      else if (a.b === me) flags[a.a]! |= 1;
    }
    for (const p of frame.players)
      if (p.alive && p.traitorUntilTick > frame.tick) flags[p.id]! |= 2;
    return flags;
  }

  /** K: ally with the player under the cursor (asks, or accepts their request). */
  private allyWithHovered(): void {
    const owner = ui.hover?.owner ?? 0;
    const status = allianceStatus(ui.diplomacyContext, owner);
    if (status.kind === "canAsk" || status.kind === "theyAsked") this.requestAlliance(owner);
  }

  /** Y / N: answer the top diplomacy card. */
  private answerTopCard(yes: boolean): void {
    const card = diplomacyCards(ui.diplomacyContext).find(
      (c) => c.kind === "request" || (!c.waiting && !ui.dismissedRenewals.has(c.ally)),
    );
    if (!card) return;
    if (card.kind === "request") this.replyAlliance(card.from, yes);
    else if (yes) this.renewAlliance(card.ally);
    else this.dismissRenewal(card.ally);
  }

  private primaryClick(at: ScreenPoint): void {
    const map = this.map;
    const tile = this.camera.tileAt(at);
    if (!map || !tile || ui.screen !== "game" || !this.host || ui.menu) return;
    const index = tileAt(map, tile.x, tile.y);
    if (ui.phase === "spawn" && !ui.me?.ready) {
      this.host.send({ type: "spawn", tile: index });
      return;
    }
    if (ui.placing === "wall") {
      this.addWallPoint(index);
      return;
    }
    if (ui.placing) {
      this.placeBuilding(index);
      return;
    }
    // A click on a building icon opens its card instead of attacking (GAME_DESIGN.md §3.17).
    const hit = this.buildingUnder(at);
    if (hit !== null) {
      ui.menu = { kind: "building", x: at.x, y: at.y, id: hit };
      return;
    }
    // So does a click on one of your walls (an enemy's wall is attacked like their land).
    const point = this.camera.screenToWorld(at);
    const mine = ui.walls.filter((w) => w.owner === ui.localPlayerId);
    const wall = wallAtPoint(mine, map.width, point.x, point.y, 0.75);
    if (wall) {
      ui.menu = { kind: "wall", x: at.x, y: at.y, id: wall.id };
      return;
    }
    this.attackTile(index, ui.attackPercent);
  }

  /** Places the building we're holding at `tile`, if it may go there. */
  private placeBuilding(tile: number): void {
    const type = ui.placing;
    if (!type || type === "wall" || !this.host) return;
    const problem = placementCheck(ui.buildContext, type, tile);
    if (problem) {
      this.toast({ text: `Can't build there: ${BUILD_BLOCK_TEXT[problem]}`, tone: "info" });
      return;
    }
    this.host.send({ type: "build", buildingType: type, tile });
    ui.placing = null;
  }

  /** Right click: the context menu for the land under the cursor (or put a building back). */
  private secondaryClick(at: ScreenPoint): void {
    if (ui.placing === "wall") {
      this.finishWall();
      return;
    }
    if (ui.placing) {
      ui.placing = null;
      return;
    }
    const map = this.map;
    const tile = this.camera.tileAt(at);
    if (!map || !tile || ui.screen !== "game" || ui.phase !== "playing" || ui.menu) return;
    const index = tileAt(map, tile.x, tile.y);
    if (!isLand(map, index)) return;
    ui.menu = { kind: "context", x: at.x, y: at.y, tile: index, owner: this.owner[index]! };
    this.hints.complete("menus");
  }

  /** The building whose icon is under this screen point (as drawn now), or null. */
  private buildingUnder(at: ScreenPoint): number | null {
    const map = this.map;
    if (!map) return null;
    const zoom = this.camera.zoom;
    const natural = zoom * ICON_PX_PER_ZOOM;
    const size = iconSize(zoom);
    const point = this.camera.screenToWorld(at);
    const icons =
      natural >= ICON_MIN_PX
        ? ui.buildings
        : ui.buildings.filter((b) => b.owner === ui.localPlayerId || b.level >= 3);
    const hit = buildingAtPoint(icons, map.width, point.x, point.y, (size * 0.6) / zoom);
    if (hit || natural >= ICON_MIN_PX) return hit?.id ?? null;
    // Zoomed out, other buildings are small dots (render/buildings.ts).
    return buildingAtPoint(ui.buildings, map.width, point.x, point.y, 6 / zoom)?.id ?? null;
  }

  private key(action: KeyAction): void {
    switch (action) {
      case "togglePerf":
        this.perf.toggle();
        break;
      case "centerOnMe": {
        const place = this.placements.get(ui.localPlayerId);
        if (place) this.camera.focusOn(place);
        break;
      }
      case "confirm":
        if (ui.placing === "wall") this.finishWall();
        else this.confirmSpawn();
        break;
      case "escape":
        if (ui.placing) {
          ui.placing = null;
          ui.wallPoints = [];
        } else if (ui.menu) this.closeMenu();
        else this.pause();
        break;
      case "preset1":
      case "preset2":
      case "preset3":
      case "preset4":
      case "preset5":
        ui.attackPercent = presetPercent(Number(action.slice(-1)) - 1);
        break;
      case "percentDown":
        ui.attackPercent = stepPercent(ui.attackPercent, -1);
        break;
      case "percentUp":
        ui.attackPercent = stepPercent(ui.attackPercent, 1);
        break;
      case "ally":
        this.allyWithHovered();
        break;
      case "mobilize":
        this.mobilize();
        break;
      case "diplomacyYes":
      case "diplomacyNo":
        if (ui.screen === "game") this.answerTopCard(action === "diplomacyYes");
        break;
    }
  }

  private resize(): void {
    this.renderer.resize();
    this.labels.resize();
    this.camera.setViewport(this.mapCanvas.clientWidth, this.mapCanvas.clientHeight);
  }

  private animationFrame(time: number): void {
    const startedAt = performance.now();
    const dt = Math.min(0.1, Math.max(0, (time - this.lastFrameTime) / 1000));
    this.lastFrameTime = time;

    this.controls.update(dt);
    this.camera.update(dt);
    const view = {
      centerX: this.camera.center.x,
      centerY: this.camera.center.y,
      zoom: this.camera.zoom,
    };

    this.updateHover();
    this.updateHint();
    this.refreshLabels(startedAt);
    this.renderer.setPlayerFlags(this.animatedFlags(startedAt));
    const tick = this.currentTick();
    this.renderer.render(view, tick, time / 1000);
    const frame = this.latestFrame;
    const players = frame?.players ?? [];
    const friends = ui.friends;
    this.labels.clear();
    if (this.map && ui.screen === "game") {
      this.buildingLayer.draw(view, {
        buildings: ui.buildings,
        width: this.map.width,
        tick,
        localPlayerId: ui.localPlayerId,
        colorOf: (id) => ui.colorOf(id),
        selectedId: ui.menu?.kind === "building" ? ui.menu.id : null,
        ghost: this.buildGhost(),
        walls: ui.walls,
        selectedWall: ui.menu?.kind === "wall" ? ui.menu.id : null,
        wallPreview: this.wallDraft(),
      });
      this.boatLayer.draw(view, {
        boats: ui.boats,
        width: this.map.width,
        tick,
        localPlayerId: ui.localPlayerId,
        colorOf: (id) => ui.colorOf(id),
        owner: this.owner,
        preview: ui.boatPreview,
      });
    }
    this.labels.draw(
      view,
      this.placements,
      players.map((p) => ({
        id: p.id,
        name: p.name,
        troops: p.homeTroops,
        alive: p.alive,
        tribe: p.tier === "tribe",
        relation:
          frame && p.traitorUntilTick > frame.tick ? "traitor" : friends.has(p.id) ? "ally" : null,
      })),
    );

    this.labels.drawLoot(view, this.lootFloaters(startedAt));

    this.perf.recordFrame(performance.now() - startedAt, this.renderer.lastUploadMs);
    requestAnimationFrame((next) => this.animationFrame(next));
  }

  /** While drawing a wall: the points so far plus the tile under the mouse. */
  private wallDraft(): WallPreview | null {
    const map = this.map;
    if (ui.placing !== "wall" || !map) return null;
    const cell = this.hoverPoint ? this.camera.tileAt(this.hoverPoint) : null;
    const hover = cell ? tileAt(map, cell.x, cell.y) : null;
    return wallPreview(ui.buildContext, ui.wallPoints, hover);
  }

  /** While a building is picked up: where it would go (the tile under the mouse). */
  private buildGhost(): BuildGhost | null {
    const type = ui.placing;
    const map = this.map;
    const point = this.hoverPoint;
    if (!type || type === "wall" || !map || !point) return null;
    const cell = this.camera.tileAt(point);
    if (!cell) return null;
    const tile = tileAt(map, cell.x, cell.y);
    return {
      type,
      tile,
      ok: placementCheck(ui.buildContext, type, tile) === null,
      radius: DEFAULT_RULES.buildings.minSpacing,
    };
  }

  /** The current tick plus how far we are toward the next one (for smooth animations). */
  private currentTick(): number {
    const frame = this.latestFrame;
    const host = this.host;
    if (!frame || !host) return 0;
    if (host.paused) return frame.tick;
    const progress = (performance.now() - host.lastFrameTime) / host.tickMs;
    return frame.tick + Math.min(1, Math.max(0, progress));
  }

  private updateHover(): void {
    const map = this.map;
    const point = this.hoverPoint;
    const cell = point && map ? this.camera.tileAt(point) : null;
    const tile = cell && map ? tileAt(map, cell.x, cell.y) : -1;
    const owner = tile >= 0 ? this.owner[tile]! : 0;
    this.renderer.setHoverOwner(owner);

    // The hover card: land only, in a running game, while no menu is open.
    const prev = ui.hover;
    if (
      !point ||
      !map ||
      tile < 0 ||
      !isLand(map, tile) ||
      ui.screen !== "game" ||
      ui.menu ||
      ui.placing
    ) {
      if (prev) ui.hover = null;
      if (ui.boatPreview) ui.boatPreview = null;
      this.boatPreviewTile = -1;
      return;
    }
    const same =
      prev &&
      prev.tile === tile &&
      prev.owner === owner &&
      prev.x === point.x &&
      prev.y === point.y;
    if (!same) ui.hover = { tile, owner, terrain: map.terrain[tile]!, x: point.x, y: point.y };
    this.updateBoatPreview(tile);
  }

  /**
   * The crossing a click on the hovered land would start (GAME_DESIGN.md §3.18): planned once
   * the mouse rests on a tile for a moment, and again twice a second while it stays (land
   * changes hands, boats come and go) — a route search is too costly for every frame.
   */
  private updateBoatPreview(tile: number): void {
    const now = performance.now();
    if (tile !== this.hoverTile) {
      this.hoverTile = tile;
      this.hoverSince = now;
    }
    if (now - this.hoverSince < BOAT_PREVIEW_REST_MS) return;
    if (tile === this.boatPreviewTile && now - this.boatPreviewAt < 500) return;
    this.boatPreviewTile = tile;
    this.boatPreviewAt = now;
    const owner = tile >= 0 ? this.owner[tile]! : 0;
    const blocked =
      ui.friends.has(owner) || (owner !== 0 && protectionSecondsLeft(ui.previewContext) > 0);
    const preview = blocked ? null : boatPreview(ui.boatContext, tile);
    if (preview !== null || ui.boatPreview !== null) ui.boatPreview = preview;
  }

  private updateHint(): void {
    const me = ui.me;
    const playing = ui.screen === "game" && ui.phase === "playing" && !!me?.alive && !ui.menu;
    const canAttackPlayer =
      playing &&
      protectionSecondsLeft(ui.previewContext) === 0 &&
      !!me?.neighbors?.some((id) => id !== 0);
    const canMobilize = playing && !!me && mobilizePreview(DEFAULT_RULES, me).blocked === null;
    const canBuild =
      playing &&
      !!me &&
      DEFAULT_RULES.buildings.enabled &&
      me.gold >= DEFAULT_RULES.buildings.types.housing.levels[0].cost;
    const hint = this.hints.update(
      { playing, canAttackPlayer, canMobilize, canBuild },
      performance.now() / 1000,
    );
    if (hint !== ui.hint) ui.hint = hint;
  }

  private refreshLabels(now: number): void {
    if (!this.labelsDirty || !this.map || now - this.lastLabelRefresh < LABEL_REFRESH_MS) return;
    this.placements = computeLabelPlacements(this.owner, this.map.width, this.map.height);
    this.labelsDirty = false;
    this.lastLabelRefresh = now;
  }
}
