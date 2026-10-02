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
import type { PlayerSetup } from "../../sim/world.ts";
import { Camera } from "../camera/camera.ts";
import { Controls, type KeyAction, type ScreenPoint } from "../input/controls.ts";
import { computeLabelPlacements, LabelLayer, type LabelPlacement } from "../render/labels.ts";
import { PerfOverlay } from "../render/perfOverlay.ts";
import { MapRenderer } from "../render/renderer.ts";
import { DEFAULT_RULES, type Difficulty } from "../../sim/rules.ts";
import { presetPercent, stepPercent } from "./attackPercent.ts";
import { allianceStatus, diplomacyCards } from "./diplomacy.ts";
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

export interface ClientElements {
  mapCanvas: HTMLCanvasElement;
  labelCanvas: HTMLCanvasElement;
  overlayParent: HTMLElement;
  fontFamily: string;
}

export class GameClient {
  private readonly renderer: MapRenderer;
  private readonly labels: LabelLayer;
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

  constructor(elements: ClientElements) {
    this.mapCanvas = elements.mapCanvas;
    this.renderer = new MapRenderer(elements.mapCanvas);
    this.labels = new LabelLayer(elements.labelCanvas, elements.fontFamily);
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
    this.owner = new Uint16Array(map.width * map.height);
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

  /** Attacks (or expands into) the land at `tile` with `percent`% of our home troops. */
  attackTile(tile: number, percent: number): void {
    const me = ui.me;
    if (!this.host || !this.map || ui.phase !== "playing" || !me?.alive) return;
    if (!isLand(this.map, tile)) return;
    const target = this.owner[tile]!;
    if (target === me.id) return;
    // Neutral land → expand; enemy land → attack. The simulation validates the rest.
    this.host.send({
      type: "attack",
      target,
      focusTile: tile,
      percentBp: Math.round(percent * 100),
    });
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
      this.renderer.setMap(this.map, this.owner);
    }
    this.renderer.setAttacks([], 0);
    this.renderer.setHoverOwner(0);
    this.placements.clear();
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
      } else if (event.type === "eliminated" && event.playerId === ui.localPlayerId) {
        ui.eliminatedBy = event.by;
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
    const peaks = new Map<number, number>();
    for (const attack of frame.attacks) {
      peaks.set(attack.id, Math.max(attack.troops, ui.attackPeak.get(attack.id) ?? 0));
    }
    ui.attackPeak = peaks;
    this.renderer.setAttacks(frame.attacks, frame.players.length);
    this.renderer.setPlayerFlags(this.playerFlags(frame));
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
    this.attackTile(index, ui.attackPercent);
  }

  /** Right click: the context menu for the land under the cursor. */
  private secondaryClick(at: ScreenPoint): void {
    const map = this.map;
    const tile = this.camera.tileAt(at);
    if (!map || !tile || ui.screen !== "game" || ui.phase !== "playing" || ui.menu) return;
    const index = tileAt(map, tile.x, tile.y);
    if (!isLand(map, index)) return;
    ui.menu = { kind: "context", x: at.x, y: at.y, tile: index, owner: this.owner[index]! };
    this.hints.complete("menus");
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
        this.confirmSpawn();
        break;
      case "escape":
        if (ui.menu) this.closeMenu();
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
    this.renderer.render(view, this.currentTick(), time / 1000);
    const frame = this.latestFrame;
    const players = frame?.players ?? [];
    const friends = ui.friends;
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

    this.perf.recordFrame(performance.now() - startedAt, this.renderer.lastUploadMs);
    requestAnimationFrame((next) => this.animationFrame(next));
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
    if (!point || !map || tile < 0 || !isLand(map, tile) || ui.screen !== "game" || ui.menu) {
      if (prev) ui.hover = null;
      return;
    }
    const same =
      prev &&
      prev.tile === tile &&
      prev.owner === owner &&
      prev.x === point.x &&
      prev.y === point.y;
    if (!same) ui.hover = { tile, owner, terrain: map.terrain[tile]!, x: point.x, y: point.y };
  }

  private updateHint(): void {
    const me = ui.me;
    const playing = ui.screen === "game" && ui.phase === "playing" && !!me?.alive && !ui.menu;
    const canAttackPlayer =
      playing &&
      protectionSecondsLeft(ui.previewContext) === 0 &&
      !!me?.neighbors?.some((id) => id !== 0);
    const hint = this.hints.update({ playing, canAttackPlayer }, performance.now() / 1000);
    if (hint !== ui.hint) ui.hint = hint;
  }

  private refreshLabels(now: number): void {
    if (!this.labelsDirty || !this.map || now - this.lastLabelRefresh < LABEL_REFRESH_MS) return;
    this.placements = computeLabelPlacements(this.owner, this.map.width, this.map.height);
    this.labelsDirty = false;
    this.lastLabelRefresh = now;
  }
}
