/**
 * Flights on the map (GAME_DESIGN.md §3.17.7, milestone 2B.0): each flight the icon pack's
 * airplane (D-028) in the era of the Airport it took off from (test flights: level I),
 * mirrored to face where it flies, over a shadow in its owner's colour, with the number of
 * planes; a dotted line
 * on to its target — yours light, hostile ones at your land red (with a ring and the ETA),
 * everyone else's faint (flights are visible to everyone).
 *
 * Drawn with Canvas2D on the label overlay, like boats. Positions come from the tick alone
 * (app/flights.ts → the simulation's flightPoint), so flights glide smoothly between ticks.
 * Until the image has loaded, a plain aircraft glyph stands in.
 */
import type { BuildingSnapshot, FlightSnapshot } from "../../sim/frame.ts";
import type { GameMap } from "../../sim/map/gameMap.ts";
import {
  AIRLIFT_PREVIEW_TEXT,
  FLIGHT_INFO,
  flightPosition,
  flightSecondsLeft,
  type AirliftPreview,
} from "../app/flights.ts";
import { formatTroops } from "../format.ts";
import { drawSprite, FACES_LEFT, spriteHeight } from "../sprites.ts";
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
  /** Airports decide each flight's era (D-028). */
  readonly buildings: readonly BuildingSnapshot[];
  /** The airlift being aimed (GAME_DESIGN.md §3.17.7): its range ring, line and ETA. */
  readonly airlift: AirliftPreview | null;
}

const MINE = "rgba(246, 241, 228, 0.8)";
const THREAT = "rgba(255, 110, 90, 0.9)";
const OTHER = "rgba(246, 241, 228, 0.28)";
const OK = "rgba(140, 240, 190, 0.95)";
const BAD = "rgba(255, 120, 100, 0.95)";

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
    if (input.flights.length === 0 && !input.airlift) return;
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
    const size = Math.max(26, Math.min(44, view.zoom * 5));

    if (input.airlift) this.aim(input.airlift, tileScreen, view.zoom);

    // Routes first, so every aircraft sits on top of every line.
    const labels: { x: number; y: number; text: string }[] = [];
    for (const flight of input.flights) {
      const at = flightPosition(input.map, flight, input.tick);
      const here = toScreen(at.x, at.y);
      const target = tileScreen(flight.toTile);
      const mine = flight.owner === me;
      const atMe = input.owner[flight.toTile] === me;
      const incoming =
        !mine && !input.friends.has(flight.owner) && FLIGHT_INFO[flight.kind].hostile && atMe;
      // A friend's airlift to us is drawn like our own flights.
      const welcome = !mine && atMe && !FLIGHT_INFO[flight.kind].hostile;
      this.route(
        here,
        target,
        mine || welcome ? MINE : incoming ? THREAT : OTHER,
        mine || incoming || welcome ? 1.5 : 1,
      );
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
      const source =
        flight.source >= 0 ? input.buildings.find((b) => b.id === flight.source) : null;
      const level = Math.max(1, source?.level ?? 1);
      const color = input.colorOf(flight.owner);
      const height = spriteHeight("plane", level, size);
      this.shadow(p.x, p.y + height * 0.55, size, color);
      const flip = FACES_LEFT.plane ? at.dx > 0 : at.dx < 0;
      if (!drawSprite(ctx, "plane", level, p.x, p.y, size, flip)) {
        this.aircraft(p.x, p.y, at.dx, at.dy, size * 0.7, color);
      }
      if (view.zoom >= 1.5 || flight.owner === me) {
        const text =
          flight.kind === "test"
            ? `test ×${flight.planes}`
            : flight.troops >= 1
              ? `${formatTroops(flight.troops)}`
              : `×${flight.planes}`;
        labels.push({ x: p.x, y: p.y - height / 2 - 7, text });
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

  /**
   * The airlift being aimed: the Airport's range ring, and to the tile under the mouse a
   * line, a landing ring and the troops and flight time — green where it may go, red with the
   * reason where it may not.
   */
  private aim(
    aim: AirliftPreview,
    tileScreen: (tile: number) => { x: number; y: number },
    zoom: number,
  ): void {
    const ctx = this.context;
    const from = tileScreen(aim.airport.tile);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(246, 241, 228, 0.7)";
    ctx.fillStyle = "rgba(246, 241, 228, 0.05)";
    ctx.beginPath();
    ctx.arc(from.x, from.y, aim.range * zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (aim.tile === null) return;
    const to = tileScreen(aim.tile);
    const color = aim.problem ? BAD : OK;
    this.route(from, to, color, 2);
    this.ring(to.x, to.y, Math.max(6, zoom * 1.5), color);
    const text = aim.problem
      ? AIRLIFT_PREVIEW_TEXT[aim.problem]
      : `✈ ${formatTroops(aim.troops)} · ${Math.ceil(aim.seconds)} s`;
    this.label(to.x, to.y - Math.max(10, zoom * 1.5) - 8, text);
  }

  /** The flight's shadow on the ground, in its owner's colour. */
  private shadow(x: number, y: number, width: number, color: string): void {
    const ctx = this.context;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, width * 0.42, width * 0.12, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(10, 14, 20, 0.7)";
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
