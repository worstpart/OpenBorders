/**
 * Flights on the map (GAME_DESIGN.md §3.17.7, milestone 2B.0): each flight the icon pack's
 * airplane (D-028) — a helicopter for an airborne assault (2B.3) — in the era of the Airport
 * it took off from (test flights: level I),
 * mirrored to face where it flies, over a shadow in its owner's colour, with the number of
 * planes; a dotted line
 * on to its target — yours light, hostile ones at your land red (with a ring and the ETA),
 * everyone else's faint (flights are visible to everyone).
 *
 * SAM shots (GAME_DESIGN.md §3.17.13): a short bright streak from the SAM to the plane, then
 * a puff of flame and smoke where it was hit; Fortress Wall flak (2B.3) the same from the wall.
 *
 * Air strikes (2B.4): a wing of fighters (the same art), escorts as two small fighters beside a
 * lift's planes, and each suppression zone as an orange hatched circle with its countdown
 * (zones are public, like flights).
 *
 * Missiles (2B.5): the second sheet's missile art turned to its heading (strike missiles by the
 * Silo's era, the bunker buster and the warhead their own), a blast where one hits — a flash and
 * a ring over its radius — and scorched land as a charred circle with its countdown.
 *
 * Drawn with Canvas2D on the label overlay, like boats. Positions come from the tick alone
 * (app/flights.ts → the simulation's flightPoint), so flights glide smoothly between ticks.
 * Until the image has loaded, a plain aircraft glyph stands in.
 */
import type { BuildingSnapshot, FlightSnapshot } from "../../sim/frame.ts";
import type { GameRules } from "../../sim/rules.ts";
import type { Scorched, Suppression } from "../../sim/world.ts";
import { isMissile } from "../../sim/systems/missiles.ts";
import type { GameMap } from "../../sim/map/gameMap.ts";
import {
  FLIGHT_INFO,
  flightPosition,
  flightSecondsLeft,
  flightSprite,
  BLAST_MS,
  liftProblemText,
  missileEffectText,
  PUFF_MS,
  SHOT_MS,
  strikeEffectText,
  type AirliftPreview,
  type BlastEffect,
  type ShotEffect,
} from "../app/flights.ts";
import { formatTroops } from "../format.ts";
import type { ParticleSystem } from "./particles.ts";
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
  /** SAM shots still showing, and the time now (performance.now()). */
  readonly shots: readonly ShotEffect[];
  readonly now: number;
  /** Suppression zones in force (air strikes on a point, 2B.4). */
  readonly suppressions: readonly Suppression[];
  /** Scorched land in force (strategic warheads, 2B.5), and missile blasts still showing. */
  readonly scorched: readonly Scorched[];
  readonly blasts: readonly BlastEffect[];
  /** Explosion particles (sparks, fire, smoke, debris), drawn over everything else. */
  readonly particles: ParticleSystem | null;
  readonly rules: GameRules;
}

/** The missile art points up and to the right; this is its angle (radians, screen y down). */
const MISSILE_ART_ANGLE = -0.6;

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
    if (
      input.flights.length === 0 &&
      !input.airlift &&
      input.shots.length === 0 &&
      input.suppressions.length === 0 &&
      input.scorched.length === 0 &&
      input.blasts.length === 0 &&
      !input.particles?.active
    )
      return;
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

    for (const zone of input.scorched) {
      this.scorchedZone(zone, tileScreen, view.zoom, input.tick, input.tickMs, w, h);
    }
    for (const zone of input.suppressions) {
      this.zone(zone, tileScreen, view.zoom, input.tick, input.tickMs, w, h);
    }
    if (input.airlift) this.aim(input.airlift, tileScreen, view.zoom, input.rules);

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
      const sprite = flightSprite(flight.kind);
      if (isMissile(flight.kind)) {
        this.missile(sprite, level, p.x, p.y, at.dx, at.dy, size, color);
        continue;
      }
      const height = spriteHeight(sprite, level, size);
      this.shadow(p.x, p.y + height * 0.55, size, color);
      const flip = FACES_LEFT[sprite] ? at.dx > 0 : at.dx < 0;
      // Escort fighters (an Air Base's lifts, 2B.4): small fighters behind, one on each side.
      for (let k = 0; k < Math.min(2, flight.escorts); k++) {
        const side = k === 0 ? -1 : 1;
        const back = flip ? 1 : -1;
        const ex = p.x + back * size * 0.45;
        const ey = p.y + side * size * 0.35;
        if (!drawSprite(ctx, "plane", level, ex, ey, size * 0.5, flip)) {
          this.aircraft(ex, ey, at.dx, at.dy, size * 0.35, color);
        }
      }
      if (!drawSprite(ctx, sprite, level, p.x, p.y, size, flip)) {
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
    for (const shot of input.shots) this.shot(shot, tileScreen, input.now, view.zoom);
    for (const blast of input.blasts) this.blast(blast, tileScreen, input.now, view.zoom);
    input.particles?.draw(ctx, toScreen, view.zoom, input.now, w, h);
    for (const label of labels) this.label(label.x, label.y, label.text);
  }

  /** A missile: its art turned to its heading, a faint smoke trail behind in its owner's colour. */
  private missile(
    sprite: ReturnType<typeof flightSprite>,
    level: number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    size: number,
    color: string,
  ): void {
    const ctx = this.context;
    const heading = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
    const length = Math.hypot(dx, dy) || 1;
    const back = { x: x - (dx / length) * size * 0.9, y: y - (dy / length) * size * 0.9 };
    ctx.save();
    const gradient = ctx.createLinearGradient(back.x, back.y, x, y);
    gradient.addColorStop(0, "rgba(220, 220, 220, 0)");
    gradient.addColorStop(1, color);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(back.x, back.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
    const width = size * (sprite === "icbm" ? 1.1 : 0.85);
    if (!drawSprite(ctx, sprite, level, x, y, width, false, heading - MISSILE_ART_ANGLE)) {
      this.aircraft(x, y, dx, dy, size * 0.5, color);
    }
  }

  /** A missile's blast: a bright flash, then a ring spreading over its radius and fading. */
  private blast(
    blast: BlastEffect,
    tileScreen: (tile: number) => { x: number; y: number },
    now: number,
    zoom: number,
  ): void {
    const age = now - blast.start;
    if (age < 0 || age > BLAST_MS) return;
    const t = age / BLAST_MS;
    const c = tileScreen(blast.tile);
    const r = Math.max(8, blast.radius * zoom);
    const ctx = this.context;
    ctx.save();
    // The flash: brightest at once, gone by a third of the way.
    const flash = Math.max(0, 1 - t * 3);
    if (flash > 0) {
      const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * (0.4 + 0.6 * t * 3));
      glow.addColorStop(0, `rgba(255, 250, 225, ${0.95 * flash})`);
      glow.addColorStop(0.5, `rgba(255, 190, 90, ${(blast.warhead ? 0.7 : 0.5) * flash})`);
      glow.addColorStop(1, "rgba(255, 120, 40, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // The shock ring.
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = blast.warhead ? 4 : 2.5;
    ctx.strokeStyle = blast.warhead ? "rgba(255, 210, 140, 0.95)" : "rgba(255, 170, 80, 0.9)";
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * Math.min(1, 0.15 + t * 1.2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Scorched land (a warhead, 2B.5): a charred circle with its countdown. */
  private scorchedZone(
    zone: Scorched,
    tileScreen: (tile: number) => { x: number; y: number },
    zoom: number,
    tick: number,
    tickMs: number,
    w: number,
    h: number,
  ): void {
    const c = tileScreen(zone.tile);
    const r = zone.radius * zoom;
    if (c.x + r < 0 || c.y + r < 0 || c.x - r > w || c.y - r > h) return;
    const ctx = this.context;
    ctx.save();
    const char = ctx.createRadialGradient(c.x, c.y, r * 0.2, c.x, c.y, r);
    char.addColorStop(0, "rgba(28, 20, 16, 0.55)");
    char.addColorStop(0.8, "rgba(45, 30, 22, 0.4)");
    char.addColorStop(1, "rgba(60, 38, 26, 0.15)");
    ctx.fillStyle = char;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 120, 70, 0.6)";
    ctx.stroke();
    ctx.restore();
    const seconds = Math.max(0, Math.ceil(((zone.untilTick - tick) * tickMs) / 1000));
    this.label(c.x, c.y - r - 8, `☢ scorched · ${seconds} s`, "#ff9a6b");
  }

  /** A SAM shot: the streak flies to the plane, then a puff blooms and fades there. */
  private shot(
    shot: ShotEffect,
    tileScreen: (tile: number) => { x: number; y: number },
    now: number,
    zoom: number,
  ): void {
    const age = now - shot.start;
    if (age < 0 || age > SHOT_MS + PUFF_MS) return;
    const ctx = this.context;
    const from = tileScreen(shot.fromTile);
    const to = tileScreen(shot.tile);
    ctx.save();
    if (age < SHOT_MS) {
      const t = age / SHOT_MS;
      const head = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      const tailT = Math.max(0, t - 0.35);
      const tail = { x: from.x + (to.x - from.x) * tailT, y: from.y + (to.y - from.y) * tailT };
      const gradient = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      gradient.addColorStop(0, "rgba(255, 220, 160, 0)");
      gradient.addColorStop(1, "rgba(255, 245, 220, 0.95)");
      ctx.lineCap = "round";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
    } else {
      const t = (age - SHOT_MS) / PUFF_MS;
      const r = (9 + Math.min(12, zoom * 1.5)) * (0.6 + 0.8 * t);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "rgba(90, 90, 96, 0.75)";
      ctx.beginPath();
      ctx.arc(to.x, to.y - t * 6, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 170, 70, 0.95)";
      ctx.beginPath();
      ctx.arc(to.x, to.y - t * 6, r * 0.55 * (1 - t), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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
  /** A suppression zone: an orange hatched circle over the struck land, with its countdown. */
  private zone(
    zone: Suppression,
    tileScreen: (tile: number) => { x: number; y: number },
    zoom: number,
    tick: number,
    tickMs: number,
    w: number,
    h: number,
  ): void {
    const c = tileScreen(zone.tile);
    const r = zone.radius * zoom;
    if (c.x + r < 0 || c.y + r < 0 || c.x - r > w || c.y - r > h) return;
    const ctx = this.context;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 140, 60, 0.12)";
    ctx.fill();
    ctx.clip();
    // Diagonal hatching: "out of order" without hiding the land under it.
    ctx.strokeStyle = "rgba(255, 150, 70, 0.35)";
    ctx.lineWidth = 1;
    const step = Math.max(6, zoom * 1.5);
    ctx.beginPath();
    for (let d = -2 * r; d <= 2 * r; d += step) {
      ctx.moveTo(c.x + d - r, c.y + r);
      ctx.lineTo(c.x + d + r, c.y - r);
    }
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 150, 70, 0.9)";
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const seconds = Math.max(0, Math.ceil(((zone.untilTick - tick) * tickMs) / 1000));
    this.label(c.x, c.y - r - 8, `💥 suppressed · ${seconds} s`, "#ffb36b");
  }

  private aim(
    aim: AirliftPreview,
    tileScreen: (tile: number) => { x: number; y: number },
    zoom: number,
    rules: GameRules,
  ): void {
    const ctx = this.context;
    const from = tileScreen(aim.airport.tile);
    if (Number.isFinite(aim.range)) {
      // (A Silo III reaches the whole map: no ring.)
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
    }
    if (aim.tile === null) return;
    const to = tileScreen(aim.tile);
    const color = aim.problem ? BAD : OK;
    this.route(from, to, color, 2);
    this.ring(to.x, to.y, Math.max(6, zoom * 1.5), color);
    if (aim.strike?.kind === "point") {
      // The zone the strike would suppress.
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255, 150, 70, 0.8)";
      ctx.fillStyle = "rgba(255, 140, 60, 0.08)";
      ctx.beginPath();
      ctx.arc(to.x, to.y, aim.strike.radius * zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (aim.missile) {
      // The area a strike missile hits (orange) with its crater (red, D-033), a bunker
      // buster's splash (orange), or what a warhead scorches (red).
      const warhead = aim.missile.kind === "warhead";
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = warhead ? "rgba(255, 90, 70, 0.9)" : "rgba(255, 150, 70, 0.8)";
      ctx.fillStyle = warhead ? "rgba(255, 70, 50, 0.12)" : "rgba(255, 140, 60, 0.08)";
      ctx.beginPath();
      ctx.arc(to.x, to.y, aim.missile.radius * zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (aim.missile.kind === "missile") {
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255, 90, 70, 0.95)";
        ctx.fillStyle = "rgba(255, 70, 50, 0.16)";
        ctx.beginPath();
        ctx.arc(to.x, to.y, aim.missile.craterRadius * zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    const text = aim.problem
      ? liftProblemText(aim.mode, aim.problem)
      : aim.strike
        ? `💥 ${strikeEffectText(rules, aim.strike)} · ${Math.ceil(aim.seconds)} s`
        : aim.missile
          ? `${FLIGHT_INFO[aim.mode].icon} ${missileEffectText(rules, aim.missile)} · ${formatTroops(aim.cost)} gold · ${Math.ceil(aim.seconds)} s`
          : `${aim.mode === "assault" ? "🪂" : "✈"} ${formatTroops(aim.troops)} · ${Math.ceil(aim.seconds)} s`;
    this.label(to.x, to.y - Math.max(10, zoom * 1.5) - 8, text);
    if (aim.missile?.kind === "warhead" && aim.missile.allies.length > 0) {
      this.label(
        to.x,
        to.y - Math.max(10, zoom * 1.5) - 40,
        "⚠ hits an ally's land: your alliance breaks",
        "#ff8a7a",
      );
    }
    if (!aim.problem && aim.missile && aim.planesLost > 0) {
      this.label(
        to.x,
        to.y - Math.max(10, zoom * 1.5) - 24,
        "⚠ SAMs on the route would shoot it down",
        "#ffb36b",
      );
    } else if (!aim.problem && aim.planesLost > 0) {
      // Hostile SAMs on the route (their rings are drawn under it, render/buildings.ts).
      this.label(
        to.x,
        to.y - Math.max(10, zoom * 1.5) - 24,
        aim.planesLost >= aim.planes
          ? `⚠ SAMs: all ${aim.planes} ${aim.mode === "strike" ? "fighters" : "planes"} would be shot down`
          : `⚠ SAMs: ${aim.planesLost} of ${aim.planes} ${aim.mode === "strike" ? "fighters" : "planes"} shot down`,
        "#ffb36b",
      );
    }
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

  private label(x: number, y: number, text: string, color = "#f6f1e4"): void {
    const ctx = this.context;
    ctx.save();
    ctx.font = this.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(10, 14, 20, 0.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}
