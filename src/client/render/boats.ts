/**
 * Boats on the map (GAME_DESIGN.md §3.18): each boat the icon pack's troop ship (D-028) — the
 * era of the Port it sailed from — on an oval in its owner's colour, mirrored to face along
 * its route, with the troops aboard; trade ships likewise; your own boats show the rest of
 * their route (dashed), boats sailing for your coast show theirs in red, and the crossing
 * under the mouse is previewed — route, landing ring and ETA.
 *
 * Warships (2B.6) sail the same way, bigger, with a health bar once damaged. They have no art
 * yet: the Modern troop boat drawn in grey stands in for it (labelled so in the docs and the
 * Port card) until the user's warship sheet arrives.
 *
 * Drawn with Canvas2D on the label overlay, like buildings and walls. Positions come from
 * the route and the tick alone (app/boats.ts), so boats glide smoothly between ticks.
 */
import type {
  BoatSnapshot,
  BuildingSnapshot,
  TradeShipSnapshot,
  WarshipSnapshot,
} from "../../sim/frame.ts";
import type { GameRules } from "../../sim/rules.ts";
import {
  boatLevel,
  boatPosition,
  boatSteps,
  warshipSize,
  warshipVoyage,
  type BoatPreview,
} from "../app/boats.ts";
import { formatTroops } from "../format.ts";
import { drawSprite, FACES_LEFT, hasSprite, spriteHeight, type SpriteKind } from "../sprites.ts";
import type { MapView } from "./renderer.ts";

export interface BoatDrawInput {
  readonly boats: readonly BoatSnapshot[];
  /** Trade ships (GAME_DESIGN.md §3.19): small hulls with a gold cargo dot, no labels. */
  readonly tradeShips: readonly TradeShipSnapshot[];
  /** Warships (2B.6); those in their shipyard (sunk) are not drawn. */
  readonly warships: readonly WarshipSnapshot[];
  /** Your warship selected for orders (the user after 2B.6), or null. */
  readonly selectedWarship: number | null;
  /** Where your warships patrol: their Base's tile and patrol radius, by warship id. */
  readonly patrolOf: (ship: WarshipSnapshot) => { center: number; range: number } | null;
  readonly width: number;
  /** Tick with fraction (smooth movement). */
  readonly tick: number;
  readonly localPlayerId: number;
  readonly colorOf: (id: number) => string;
  /** Who owns each tile now (to tell which boats sail for our coast). */
  readonly owner: Uint16Array;
  readonly preview: BoatPreview | null;
  /** Ports decide each ship's era (D-028). */
  readonly buildings: readonly BuildingSnapshot[];
  readonly rules: GameRules;
}

const MINE = "rgba(246, 241, 228, 0.75)";
const THREAT = "rgba(255, 110, 90, 0.85)";
const OK = "rgba(140, 240, 190, 0.95)";
const BAD = "rgba(255, 120, 100, 0.95)";
/** The selected warship, its route and patrol area. */
const SELECTED = "rgba(255, 255, 255, 0.9)";

export class BoatLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly font: string;
  /** Each ship's era, fixed when it is first seen (its Port may change later). */
  private readonly boatLevels = new Map<number, number>();
  private readonly shipLevels = new Map<number, number>();

  constructor(canvas: HTMLCanvasElement, fontFamily: string) {
    this.canvas = canvas;
    this.font = `600 11px ${fontFamily}`;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    this.context = context;
  }

  draw(view: MapView, input: BoatDrawInput): void {
    const ctx = this.context;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const halfW = this.canvas.clientWidth / 2;
    const halfH = this.canvas.clientHeight / 2;
    const toScreen = (x: number, y: number) => ({
      x: (x - view.centerX) * view.zoom + halfW,
      y: (y - view.centerY) * view.zoom + halfH,
    });
    const tileScreen = (tile: number) =>
      toScreen((tile % input.width) + 0.5, Math.floor(tile / input.width) + 0.5);

    const preview = input.preview;
    if (preview?.plan) {
      const color = preview.problem ? BAD : OK;
      const points = [preview.plan.launchTile, ...preview.plan.route, preview.plan.landingTile];
      this.route(points.map(tileScreen), color, 2);
      const land = tileScreen(preview.plan.landingTile);
      this.ring(land.x, land.y, Math.max(6, view.zoom * 1.5), color);
    }

    prune(this.boatLevels, input.boats);
    prune(this.shipLevels, input.tradeShips);
    const tradeSize = Math.max(12, Math.min(34, view.zoom * 4.5));
    for (const ship of input.tradeShips) {
      const at = boatPosition(ship, input.width, input.tick);
      const p = toScreen(at.x, at.y);
      if (p.x < -40 || p.y < -40 || p.x > halfW * 2 + 40 || p.y > halfH * 2 + 40) continue;
      let level = this.shipLevels.get(ship.id);
      if (level === undefined) {
        level = Math.max(1, input.buildings.find((b) => b.id === ship.fromPort)?.level ?? 1);
        this.shipLevels.set(ship.id, level);
      }
      if (!this.ship("tradeShip", level, p.x, p.y, at.dx, tradeSize, input.colorOf(ship.owner))) {
        this.tradeHull(p.x, p.y, at.dx, at.dy, tradeSize * 0.5, input.colorOf(ship.owner));
      }
    }

    const warSize = warshipSize(view.zoom);
    // Your warships' orders: an anchor where each was sent; the selected one also shows its
    // patrol area and the way there.
    for (const ship of input.warships) {
      if (ship.readyTick >= 0 || ship.owner !== input.localPlayerId) continue;
      const selected = ship.id === input.selectedWarship;
      if (selected) {
        const area = input.patrolOf(ship);
        if (area) {
          const c = tileScreen(area.center);
          this.dashedCircle(c.x, c.y, area.range * view.zoom, SELECTED);
        }
        const here = boatPosition(warshipVoyage(ship), input.width, input.tick);
        const done = Math.floor(boatSteps(warshipVoyage(ship), input.tick));
        const ahead: number[] = [];
        for (let k = Math.max(1, done + 1); k <= ship.route.length; k++)
          ahead.push(ship.route[k - 1]!);
        ahead.push(ship.toTile);
        this.route([toScreen(here.x, here.y), ...ahead.map(tileScreen)], SELECTED, 1.5);
      }
      if (ship.patrolTile >= 0) {
        const a = tileScreen(ship.patrolTile);
        this.label(a.x, a.y, "⚓");
      }
    }
    for (const ship of input.warships) {
      if (ship.readyTick >= 0) continue;
      const at = boatPosition(warshipVoyage(ship), input.width, input.tick);
      const p = toScreen(at.x, at.y);
      if (ship.id === input.selectedWarship) {
        this.ring(p.x, p.y + warSize * 0.1, warSize * 0.68, SELECTED);
      }
      if (p.x < -50 || p.y < -50 || p.x > halfW * 2 + 50 || p.y > halfH * 2 + 50) continue;
      const color = input.colorOf(ship.owner);
      const drawn = hasSprite("warship", 3)
        ? this.ship("warship", 3, p.x, p.y, at.dx, warSize, color)
        : this.ship("boat", 3, p.x, p.y, at.dx, warSize, color, STAND_IN);
      if (!drawn) this.hull(p.x, p.y, at.dx, at.dy, warSize * 0.5, color);
      const hpShare = ship.hp / input.rules.warships.hp;
      if (hpShare < 1) {
        this.healthBar(p.x, p.y - spriteHeight("boat", 3, warSize) / 2 - 5, warSize * 0.7, hpShare);
      }
    }

    const size = Math.max(16, Math.min(44, view.zoom * 5.5));
    for (const boat of input.boats) {
      const mine = boat.owner === input.localPlayerId;
      const incoming =
        !mine && boat.recallTick < 0 && input.owner[boat.landingTile] === input.localPlayerId;
      if (mine || incoming) {
        // The rest of the trip: on to the landing, or (recalled) back to the launch coast.
        const done = Math.floor(boatSteps(boat, input.tick));
        const ahead: number[] = [];
        if (boat.recallTick < 0) {
          for (let k = Math.max(1, done + 1); k <= boat.route.length; k++)
            ahead.push(boat.route[k - 1]!);
          ahead.push(boat.landingTile);
        } else {
          for (let k = Math.min(boat.route.length, done); k >= 1; k--)
            ahead.push(boat.route[k - 1]!);
          ahead.push(boat.launchTile);
        }
        const here = boatPosition(boat, input.width, input.tick);
        this.route(
          [toScreen(here.x, here.y), ...ahead.map(tileScreen)],
          incoming ? THREAT : MINE,
          incoming ? 2 : 1.5,
        );
        if (incoming) {
          const land = tileScreen(boat.landingTile);
          this.ring(land.x, land.y, Math.max(6, view.zoom * 1.5), THREAT);
        }
      }
    }
    for (const boat of input.boats) {
      const at = boatPosition(boat, input.width, input.tick);
      const p = toScreen(at.x, at.y);
      if (p.x < -40 || p.y < -40 || p.x > halfW * 2 + 40 || p.y > halfH * 2 + 40) continue;
      let level = this.boatLevels.get(boat.id);
      if (level === undefined) {
        level = boatLevel(input.rules, input.width, input.buildings, boat.owner, boat.launchTile);
        this.boatLevels.set(boat.id, level);
      }
      const color = input.colorOf(boat.owner);
      if (!this.ship("boat", level, p.x, p.y, at.dx, size, color)) {
        this.hull(p.x, p.y, at.dx, at.dy, size * 0.5, color);
      }
      if (view.zoom >= 1.5 || boat.owner === input.localPlayerId) {
        this.label(p.x, p.y - spriteHeight("boat", level, size) / 2 - 7, formatTroops(boat.troops));
      }
    }
    if (preview?.plan) {
      const land = tileScreen(preview.plan.landingTile);
      this.label(
        land.x,
        land.y - Math.max(10, view.zoom * 1.5) - 8,
        `⛵ ${Math.ceil(preview.seconds)} s`,
      );
    }
  }

  private route(points: readonly { x: number; y: number }[], color: string, width: number): void {
    if (points.length < 2) return;
    const ctx = this.context;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(10, 14, 20, 0.45)";
    ctx.lineWidth = width + 2;
    this.polyline(points);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  private polyline(points: readonly { x: number; y: number }[]): void {
    const ctx = this.context;
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    // Every other point is plenty: routes are drawn at map scale, a tile is a few pixels.
    for (let k = 1; k < points.length - 1; k += 2) ctx.lineTo(points[k]!.x, points[k]!.y);
    ctx.lineTo(points.at(-1)!.x, points.at(-1)!.y);
  }

  private dashedCircle(x: number, y: number, radius: number, color: string): void {
    const ctx = this.context;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private ring(x: number, y: number, radius: number, color: string): void {
    const ctx = this.context;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A ship sprite `width` px wide on an oval in its owner's colour, facing along `dx`.
   * False while the image is still loading (draw the plain hull then).
   */
  private ship(
    kind: SpriteKind,
    level: number,
    x: number,
    y: number,
    dx: number,
    width: number,
    color: string,
    filter = "none",
  ): boolean {
    const ctx = this.context;
    const height = spriteHeight(kind, level, width);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y + height * 0.12, width * 0.56, height * 0.5, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = width < 24 ? 1 : 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
    const flip = FACES_LEFT[kind] ? dx > 0 : dx < 0;
    if (filter === "none") return drawSprite(ctx, kind, level, x, y, width, flip);
    ctx.save();
    ctx.filter = filter;
    const drawn = drawSprite(ctx, kind, level, x, y, width, flip);
    ctx.restore();
    return drawn;
  }

  /** A small health bar centred at (x, y): green to red by `share`. */
  private healthBar(x: number, y: number, width: number, share: number): void {
    const ctx = this.context;
    const h = 4;
    ctx.save();
    ctx.fillStyle = "rgba(10, 14, 20, 0.8)";
    ctx.fillRect(x - width / 2 - 1, y - h / 2 - 1, width + 2, h + 2);
    ctx.fillStyle = share > 0.5 ? "#7bd88f" : share > 0.25 ? "#ffd166" : "#ff6b5a";
    ctx.fillRect(x - width / 2, y - h / 2, width * Math.max(0, share), h);
    ctx.restore();
  }

  /** A small hull with a sail, pointing along (dx, dy). */
  private hull(x: number, y: number, dx: number, dy: number, size: number, color: string): void {
    const ctx = this.context;
    const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(x, y);
    // Hull seen from above, along the heading.
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(size * 0.6, 0);
    ctx.quadraticCurveTo(size * 0.2, -size * 0.32, -size * 0.5, -size * 0.26);
    ctx.lineTo(-size * 0.5, size * 0.26);
    ctx.quadraticCurveTo(size * 0.2, size * 0.32, size * 0.6, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(10, 14, 20, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // The sail stays upright so it reads as a boat whatever the heading.
    ctx.beginPath();
    ctx.moveTo(-size * 0.05, -size * 0.75);
    ctx.lineTo(size * 0.32, -size * 0.12);
    ctx.lineTo(-size * 0.05, -size * 0.12);
    ctx.closePath();
    ctx.fillStyle = "#f6f1e4";
    ctx.strokeStyle = "rgba(10, 14, 20, 0.85)";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** A trade ship: a small hull along its heading with a gold cargo dot amidships. */
  private tradeHull(x: number, y: number, dx: number, dy: number, size: number, color: string) {
    const ctx = this.context;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.moveTo(size * 0.6, 0);
    ctx.quadraticCurveTo(size * 0.15, -size * 0.36, -size * 0.5, -size * 0.3);
    ctx.lineTo(-size * 0.5, size * 0.3);
    ctx.quadraticCurveTo(size * 0.15, size * 0.36, size * 0.6, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    // A light rim: trade hulls are small and must read on dark water in any colour.
    ctx.strokeStyle = "rgba(246, 241, 228, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(10, 14, 20, 0.85)";
    ctx.arc(-size * 0.02, 0, size * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd166";
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  private label(x: number, y: number, text: string): void {
    const ctx = this.context;
    ctx.save();
    ctx.font = this.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(10, 14, 20, 0.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#f6f1e4";
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

/** The stand-in for warship art (2B.6): the Modern troop boat, greyed like a warship. */
const STAND_IN = "grayscale(1) brightness(0.8) contrast(1.25)";

/** Forgets the eras of ships no longer at sea. */
function prune(levels: Map<number, number>, ships: readonly { readonly id: number }[]): void {
  if (levels.size <= ships.length + 32) return;
  const live = new Set(ships.map((s) => s.id));
  for (const id of levels.keys()) if (!live.has(id)) levels.delete(id);
}
