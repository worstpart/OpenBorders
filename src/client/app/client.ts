/**
 * The game client: wires host ↔ renderer ↔ camera ↔ input ↔ UI state, and runs the
 * animation-frame loop. Rules live in the simulation; this file only translates.
 */
import { LocalHost } from "../../host/localHost.ts";
import type { FrameTiming } from "../../host/host.ts";
import type { TickFrame } from "../../sim/frame.ts";
import { isLand, tileAt, type GameMap } from "../../sim/map/gameMap.ts";
import { generateContinent } from "../../sim/map/generate.ts";
import type { PlayerSetup } from "../../sim/world.ts";
import { Camera } from "../camera/camera.ts";
import { Controls, type KeyAction, type ScreenPoint } from "../input/controls.ts";
import { computeLabelPlacements, LabelLayer, type LabelPlacement } from "../render/labels.ts";
import { PerfOverlay } from "../render/perfOverlay.ts";
import { MapRenderer } from "../render/renderer.ts";
import { presetPercent, stepPercent } from "./attackPercent.ts";
import { pickBotNames, playerColors } from "./players.ts";
import { ui } from "./uiState.svelte.ts";

/** Phase 1 plays on one fixed procedural continent (ROADMAP Phase 1). */
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

  constructor(elements: ClientElements) {
    this.mapCanvas = elements.mapCanvas;
    this.renderer = new MapRenderer(elements.mapCanvas);
    this.labels = new LabelLayer(elements.labelCanvas, elements.fontFamily);
    this.perf = new PerfOverlay(elements.overlayParent);
    this.controls = new Controls(elements.mapCanvas, {
      primaryClick: (at) => this.primaryClick(at),
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

  /** Generates the Phase 1 map and shows it behind the start screen. */
  loadMap(): void {
    const map = generateContinent({ seed: MAP_SEED });
    this.map = map;
    this.owner = new Uint16Array(map.width * map.height);
    this.renderer.setMap(map, this.owner);
    this.renderer.setPlayerColors(["#000000"]);
    this.camera.setMap(map.width, map.height);
    this.placements.clear();
    ui.landTiles = map.landTiles;
    ui.screen = "start";
  }

  /** Starts a single-player game against `opponents` bots. */
  async startGame(opponents: number): Promise<void> {
    const map = this.map;
    if (!map) throw new Error("startGame() before loadMap()");
    this.host?.dispose();

    const random = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
    const players: PlayerSetup[] = [
      { name: "You", kind: "human" },
      ...pickBotNames(opponents, random).map((name) => ({ name, kind: "bot" as const })),
    ];
    const colors = playerColors(players.length);
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
    ui.colors = colors;
    ui.localPlayerId = initial.localPlayerId;
    this.publish(initial.frame);
    ui.screen = "game";
  }

  retreat(attackId: number): void {
    this.host?.send({ type: "retreat", attackId });
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
    for (const event of frame.events) {
      if (event.type === "commandRejected" && event.playerId === ui.localPlayerId) {
        console.info(`Command "${event.command}" rejected: ${event.reason}`);
      }
    }
    this.publish(frame);
  }

  /** Copies what the UI needs from a frame into the reactive UI state. */
  private publish(frame: TickFrame): void {
    ui.tick = frame.tick;
    ui.phase = frame.phase;
    ui.playStartTick = frame.playStartTick;
    ui.players = frame.players;
    ui.attacks = frame.attacks;
    this.renderer.setAttacks(frame.attacks, frame.players.length);
  }

  private primaryClick(at: ScreenPoint): void {
    const map = this.map;
    const tile = this.camera.tileAt(at);
    if (!map || !tile || ui.screen !== "game" || !this.host) return;
    const index = tileAt(map, tile.x, tile.y);
    if (ui.phase === "spawn" && !ui.me?.ready) {
      this.host.send({ type: "spawn", tile: index });
      return;
    }
    const me = ui.me;
    if (ui.phase !== "playing" || !me?.alive || !isLand(map, index)) return;
    const target = this.owner[index]!;
    if (target === me.id) return; // own land: nothing to do (selection comes with the HUD)
    // Neutral land → expand; enemy land → attack. The simulation validates the rest.
    this.host.send({ type: "attack", target, focusTile: index, percentBp: ui.attackPercent * 100 });
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
        break; // the pause menu arrives in milestone 1.6
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
    this.refreshLabels(startedAt);
    this.renderer.render(view, this.currentTick(), time / 1000);
    const players = this.latestFrame?.players ?? [];
    this.labels.draw(
      view,
      this.placements,
      players.map((p) => ({ id: p.id, name: p.name, troops: p.homeTroops, alive: p.alive })),
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
    const tile = this.hoverPoint && this.map ? this.camera.tileAt(this.hoverPoint) : null;
    const owner = tile && this.map ? this.owner[tileAt(this.map, tile.x, tile.y)]! : 0;
    this.renderer.setHoverOwner(owner);
  }

  private refreshLabels(now: number): void {
    if (!this.labelsDirty || !this.map || now - this.lastLabelRefresh < LABEL_REFRESH_MS) return;
    this.placements = computeLabelPlacements(this.owner, this.map.width, this.map.height);
    this.labelsDirty = false;
    this.lastLabelRefresh = now;
  }
}
