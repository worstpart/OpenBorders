/**
 * Flights on the map (GAME_DESIGN.md §3.17.7, milestone 2B.0): each flight a small aircraft
 * in its owner's colour, pointing where it flies, with the number of planes; a dotted line
 * on to its target — yours light, hostile ones at your land red (with a ring and the ETA),
 * everyone else's faint (flights are visible to everyone).
 *
 * Drawn with Canvas2D on the label overlay, like boats. Positions come from the tick alone
 * (app/flights.ts → the simulation's flightPoint), so flights glide smoothly between ticks.
 * 2B.0b replaces the glyph with the icon pack's airplanes (D-028).
 */
import type { FlightSnapshot } from "../../sim/frame.ts";
import type { GameMap } from "../../sim/map/gameMap.ts";
import { FLIGHT_INFO, flightPosition, flightSecondsLeft } from "../app/flights.ts";
import type { MapView } from "./renderer.ts";

export interface FlightDrawInput {
  readonly map: GameMap;
  readonly flights: readonly FlightSnapshot[];
  /** Tick with fraction (smooth movement). */
  readonly tick: number;
  readonly tickMs: number;
  readonly localPlayerId: number;
  /** Allies and teammates: their flights at us are not threats. */
  readonly friends: ReadonlySet<number>;
  readonly colorOf: (id: number) => string;
  /** Who owns each tile now (which flights are coming for our land). */
  readonly owner: Uint16Array;
}

const MINE = "rgba(246, 241, 228, 0.8)";
const THREAT = "rgba(255, 110, 90, 0.9)";
const OTHER = "rgba(246, 241, 228, 0.28)";

export class FlightLayer {
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

  draw(view: MapView, input: FlightDrawInput): void {
    if (input.flights.length === 0) return;
    const ctx = this.context;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const toScreen = (x: number, y: number) => ({
      x: (x - view.centerX) * view.zoom + w / 2,
      y: (y - view.centerY) * view.zoom + h / 2,
    });
    const width = input.map.width;
    const tileScreen = (tile: number) =>
      toScreen((tile % width) + 0.5, Math.floor(tile / width) + 0.5);
    const me = input.localPlayerId;
    const size = Math.max(18, Math.min(30, view.zoom * 4));

    // Routes first, so every aircraft sits on top of every line.
    const labels: { x: number; y: number; text: string }[] = [];
    for (const flight of input.flights) {
      const at = flightPosition(input.map, flight, input.tick);
      const here = toScreen(at.x, at.y);
      const target = tileScreen(flight.toTile);
      const mine = flight.owner === me;
      const incoming =
        !mine &&
        !input.friends.has(flight.owner) &&
        FLIGHT_INFO[flight.kind].hostile &&
        input.owner[flight.toTile] === me;
      this.route(here, target, mine ? MINE : incoming ? THREAT : OTHER, mine || incoming ? 1.5 : 1);
      if (mine || incoming) {
        // Incoming flights also get the threat marker's ring and countdown (render/markers.ts).
        if (mine) this.ring(target.x, target.y, Math.max(5, view.zoom * 1.2), MINE);
        const seconds = Math.ceil(flightSecondsLeft(flight, input.tick, input.tickMs));
        if (mine) {
          labels.push({
            x: target.x,
            y: target.y - Math.max(9, view.zoom * 1.2) - 8,
            text: `${FLIGHT_INFO[flight.kind].icon} ${seconds} s`,
          });
        }
      }
    }
    for (const flight of input.flights) {
      const at = flightPosition(input.map, flight, input.tick);
      const p = toScreen(at.x, at.y);
      if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
      this.aircraft(p.x, p.y, at.dx, at.dy, size, input.colorOf(flight.owner));
      if (view.zoom >= 1.5 || flight.owner === me) {
        const what = flight.kind === "test" ? "test" : "";
        labels.push({ x: p.x, y: p.y - size * 0.95, text: `${what} ×${flight.planes}`.trim() });
      }
    }
    for (const label of labels) this.label(label.x, label.y, label.text);
  }

  private route(
    a: { x: number; y: number },
    b: { x: number; y: number },
    color: string,
    width: number,
  ) {
    const ctx = this.context;
    ctx.save();
    ctx.setLineDash([2, 5]);
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(10, 14, 20, 0.4)";
    ctx.lineWidth = width + 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  private ring(x: number, y: number, radius: number, color: string): void {
    const ctx = this.context;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** An aircraft seen from above, nose along (dx, dy). */
  private aircraft(x: number, y: number, dx: number, dy: number, size: number, color: string) {
    const ctx = this.context;
    const s = size / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.moveTo(s * 1.0, 0); // nose
    ctx.lineTo(s * 0.55, s * 0.12);
    ctx.lineTo(s * 0.15, s * 0.95); // right wing
    ctx.lineTo(-s * 0.1, s * 0.95);
    ctx.lineTo(s * 0.0, s * 0.14);
    ctx.lineTo(-s * 0.6, s * 0.12);
    ctx.lineTo(-s * 0.85, s * 0.45); // tail
    ctx.lineTo(-s * 1.0, s * 0.45);
    ctx.lineTo(-s * 0.85, 0);
    ctx.lineTo(-s * 1.0, -s * 0.45);
    ctx.lineTo(-s * 0.85, -s * 0.45);
    ctx.lineTo(-s * 0.6, -s * 0.12);
    ctx.lineTo(s * 0.0, -s * 0.14);
    ctx.lineTo(-s * 0.1, -s * 0.95); // left wing
    ctx.lineTo(s * 0.15, -s * 0.95);
    ctx.lineTo(s * 0.55, -s * 0.12);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(246, 241, 228, 0.9)";
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
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
