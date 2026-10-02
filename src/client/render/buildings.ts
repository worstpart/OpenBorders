/**
 * Building icons on the map (GAME_DESIGN.md §3.17.10): a small dark badge ringed in the
 * owner's colour, an original line drawing that grows with the level, and 1–3 level pips
 * under it — the tier reads without clicking. A building under construction is faded with
 * a progress ring; one being upgraded shows the ring at full strength.
 *
 * Drawn with Canvas2D on the label overlay (ARCHITECTURE.md §5.7 — instanced WebGL icons
 * can replace this if lobbies ever show thousands of buildings).
 */
import type { BuildingSnapshot } from "../../sim/frame.ts";
import type { BuildingType } from "../../sim/rules.ts";
import type { MapView } from "./renderer.ts";

export interface BuildingDrawInput {
  readonly buildings: readonly BuildingSnapshot[];
  /** Map width in tiles (tile → x, y). */
  readonly width: number;
  /** Tick with fraction, for progress rings. */
  readonly tick: number;
  readonly localPlayerId: number;
  readonly colorOf: (id: number) => string;
  /** The building whose card is open (highlighted). */
  readonly selectedId: number | null;
  /** While the build menu is open: where the building would go, and whether it may. */
  readonly ghost: { readonly tile: number; readonly ok: boolean; readonly radius: number } | null;
}

/** Icon size in CSS px per unit of zoom (pixels per tile), and its bounds. */
const SIZE_PER_ZOOM = 7;
const MAX_SIZE = 30;
/** Below this size only your own and level-III buildings are drawn (at this size). */
const MIN_SIZE = 13;

export class BuildingLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    this.context = context;
  }

  draw(view: MapView, input: BuildingDrawInput): void {
    const ctx = this.context;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const halfW = this.canvas.clientWidth / 2;
    const halfH = this.canvas.clientHeight / 2;
    const toScreen = (tile: number) => ({
      x: ((tile % input.width) + 0.5 - view.centerX) * view.zoom + halfW,
      y: (Math.floor(tile / input.width) + 0.5 - view.centerY) * view.zoom + halfH,
    });

    if (input.ghost) {
      const at = toScreen(input.ghost.tile);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = input.ghost.ok ? "rgba(140, 240, 190, 0.9)" : "rgba(255, 140, 120, 0.9)";
      ctx.beginPath();
      ctx.arc(at.x, at.y, Math.max(6, input.ghost.radius * view.zoom), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const natural = view.zoom * SIZE_PER_ZOOM;
    for (const b of input.buildings) {
      const mine = b.owner === input.localPlayerId;
      if (natural < MIN_SIZE && !mine && b.level < 3) continue;
      const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, natural));
      const at = toScreen(b.tile);
      if (at.x < -size || at.y < -size || at.x > halfW * 2 + size || at.y > halfH * 2 + size) {
        continue;
      }
      const working = b.readyTick >= 0;
      const progress = working
        ? Math.min(
            1,
            Math.max(0, (input.tick - b.startTick) / Math.max(1, b.readyTick - b.startTick)),
          )
        : 1;
      drawBadge(
        ctx,
        at.x,
        at.y,
        size,
        b,
        input.colorOf(b.owner),
        mine,
        progress,
        b.id === input.selectedId,
      );
    }
  }
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  b: BuildingSnapshot,
  color: string,
  mine: boolean,
  progress: number,
  selected: boolean,
): void {
  const half = size / 2;
  const building = b.level === 0; // first construction: not working yet
  ctx.save();
  ctx.globalAlpha = building ? 0.55 : 1;
  roundedRect(ctx, x - half, y - half, size, size, size * 0.26);
  ctx.fillStyle = "rgba(14, 18, 26, 0.86)";
  ctx.fill();
  ctx.lineWidth = selected ? 3 : mine ? 2.2 : 1.6;
  ctx.strokeStyle = selected ? "#ffffff" : color;
  ctx.stroke();

  // The drawing, in a box of ±1 around the centre.
  const unit = size * 0.32;
  ctx.translate(x, y - size * 0.02);
  ctx.scale(unit, unit);
  ctx.lineWidth = 0.17;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  drawGlyph(ctx, b.type, Math.max(1, b.level));
  ctx.restore();

  // Level pips under the badge: filled up to the level, hollow for the rest.
  const pip = Math.max(2.4, size * 0.11);
  const gap = pip * 2.6;
  const py = y + half + pip + 2;
  ctx.save();
  for (let k = 0; k < 3; k++) {
    const px = x + (k - 1) * gap;
    ctx.beginPath();
    ctx.arc(px, py, pip, 0, Math.PI * 2);
    if (k < b.level) {
      ctx.fillStyle = mine ? "#ffd56a" : "#ffffff";
      ctx.fill();
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(10, 14, 22, 0.7)";
    if (k < b.level) ctx.stroke();
  }
  ctx.restore();

  // Construction / upgrade progress: a ring around the badge.
  if (b.readyTick >= 0) {
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(255, 213, 106, 0.95)";
    ctx.beginPath();
    ctx.arc(x, y, half + 4, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Original line drawings; more detail per level (one house → a town → a skyline). */
function drawGlyph(ctx: CanvasRenderingContext2D, type: BuildingType, level: number): void {
  if (type === "housing") {
    if (level === 1) house(ctx, 0, 0.15, 1);
    else if (level === 2) {
      house(ctx, -0.42, 0.25, 0.75);
      house(ctx, 0.42, 0.1, 0.9);
    } else {
      // A tower between two houses.
      ctx.beginPath();
      ctx.rect(-0.22, -0.95, 0.44, 1.75);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -1.2);
      ctx.lineTo(0, -0.95);
      ctx.stroke();
      house(ctx, -0.62, 0.35, 0.55);
      house(ctx, 0.62, 0.35, 0.55);
    }
    return;
  }
  // Factory: a saw-tooth hall with one chimney per level.
  ctx.beginPath();
  ctx.moveTo(-0.95, 0.8);
  ctx.lineTo(-0.95, 0.05);
  ctx.lineTo(-0.45, -0.3);
  ctx.lineTo(-0.45, 0.05);
  ctx.lineTo(0.05, -0.3);
  ctx.lineTo(0.05, 0.05);
  ctx.lineTo(0.95, 0.05);
  ctx.lineTo(0.95, 0.8);
  ctx.closePath();
  ctx.fill();
  const chimneys = [0.55, 0.25, 0.8].slice(0, level);
  for (const cx of chimneys) {
    ctx.beginPath();
    ctx.rect(cx - 0.09, -0.85, 0.18, 0.95);
    ctx.fill();
  }
}

function house(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x - 0.6 * s, y + 0.65 * s);
  ctx.lineTo(x - 0.6 * s, y - 0.05 * s);
  ctx.lineTo(x, y - 0.65 * s);
  ctx.lineTo(x + 0.6 * s, y - 0.05 * s);
  ctx.lineTo(x + 0.6 * s, y + 0.65 * s);
  ctx.closePath();
  ctx.fill();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
