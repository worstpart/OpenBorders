/**
 * Boats on the map (GAME_DESIGN.md §3.18): each boat a small hull with a sail in its owner's
 * colour, heading along its route, with the troops aboard; your own boats show the rest of
 * their route (dashed), boats sailing for your coast show theirs in red, and the crossing
 * under the mouse is previewed — route, landing ring and ETA.
 *
 * Drawn with Canvas2D on the label overlay, like buildings and walls. Positions come from
 * the route and the tick alone (app/boats.ts), so boats glide smoothly between ticks.
 */
import type { BoatSnapshot } from "../../sim/frame.ts";
import { boatPosition, boatSteps, type BoatPreview } from "../app/boats.ts";
import { formatTroops } from "../format.ts";
import type { MapView } from "./renderer.ts";

export interface BoatDrawInput {
  readonly boats: readonly BoatSnapshot[];
  readonly width: number;
  /** Tick with fraction (smooth movement). */
  readonly tick: number;
  readonly localPlayerId: number;
  readonly colorOf: (id: number) => string;
  /** Who owns each tile now (to tell which boats sail for our coast). */
  readonly owner: Uint16Array;
  readonly preview: BoatPreview | null;
}

const MINE = "rgba(246, 241, 228, 0.75)";
const THREAT = "rgba(255, 110, 90, 0.85)";
const OK = "rgba(140, 240, 190, 0.95)";
const BAD = "rgba(255, 120, 100, 0.95)";

export class BoatLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly font: string;

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

    const size = Math.max(9, Math.min(20, view.zoom * 3.2));
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
      this.hull(p.x, p.y, at.dx, at.dy, size, input.colorOf(boat.owner));
      if (view.zoom >= 1.5 || boat.owner === input.localPlayerId) {
        this.label(p.x, p.y - size * 0.95, formatTroops(boat.troops));
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
