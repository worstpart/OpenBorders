/**
 * Player labels (name + troops) on a Canvas2D overlay (ARCHITECTURE.md §4.4).
 *
 * Placement: each label goes at the point deepest inside its owner's territory — the
 * largest open area — found with a distance transform on a 4× downsampled ownership
 * grid. Text is sized to fit that area and fades out when it would be too small to read.
 */
import { formatTroops } from "../format.ts";
import type { MapView } from "./renderer.ts";

export interface LabelPlacement {
  /** Center in tiles. */
  x: number;
  y: number;
  /** Radius of the open area around the center, in tiles. */
  radius: number;
}

export interface LabelPlayer {
  id: number;
  name: string;
  troops: number;
  alive: boolean;
  /** Tribes (weak filler bots) get a lighter label, so the nations stand out. */
  tribe?: boolean;
  /** The local player's ally (mint name) or a traitor (coral name), GAME_DESIGN.md §3.14. */
  relation?: "ally" | "traitor" | null;
}

const ALLY_NAME = "#a6f5d2";
const TRAITOR_NAME = "#ffa08f";

const CELL = 4;
const FAR = 1 << 20;

/**
 * Finds, for every owner, the cell farthest from any other owner's land (or neutral land
 * or water). Returns placements indexed by owner id.
 */
export function computeLabelPlacements(
  owner: Uint16Array,
  width: number,
  height: number,
): Map<number, LabelPlacement> {
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const cellOwner = new Uint16Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    const y = Math.min(height - 1, cy * CELL + (CELL >> 1));
    for (let cx = 0; cx < cols; cx++) {
      const x = Math.min(width - 1, cx * CELL + (CELL >> 1));
      cellOwner[cy * cols + cx] = owner[y * width + x]!;
    }
  }

  // Two-pass chamfer distance (3-4 weights ≈ Euclidean × 3) to the nearest cell with a
  // different owner; the map border counts as "different".
  const dist = new Int32Array(cols * rows);
  for (let i = 0; i < dist.length; i++) dist[i] = cellOwner[i] === 0 ? 0 : FAR;
  const relax = (i: number, j: number, cost: number): void => {
    const candidate = cellOwner[j] === cellOwner[i] ? dist[j]! + cost : cost;
    if (candidate < dist[i]!) dist[i] = candidate;
  };
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx;
      if (dist[i] === 0) continue;
      if (cx === 0 || cy === 0 || cx === cols - 1 || cy === rows - 1)
        dist[i] = Math.min(dist[i]!, 3);
      if (cx > 0) relax(i, i - 1, 3);
      if (cy > 0) {
        relax(i, i - cols, 3);
        if (cx > 0) relax(i, i - cols - 1, 4);
        if (cx < cols - 1) relax(i, i - cols + 1, 4);
      }
    }
  }
  for (let cy = rows - 1; cy >= 0; cy--) {
    for (let cx = cols - 1; cx >= 0; cx--) {
      const i = cy * cols + cx;
      if (dist[i] === 0) continue;
      if (cx < cols - 1) relax(i, i + 1, 3);
      if (cy < rows - 1) {
        relax(i, i + cols, 3);
        if (cx < cols - 1) relax(i, i + cols + 1, 4);
        if (cx > 0) relax(i, i + cols - 1, 4);
      }
    }
  }

  const placements = new Map<number, LabelPlacement>();
  const best = new Map<number, number>();
  for (let i = 0; i < dist.length; i++) {
    const id = cellOwner[i]!;
    if (id === 0) continue;
    if (!best.has(id) || dist[i]! > dist[best.get(id)!]!) best.set(id, i);
  }
  // Several cells often tie for "deepest" (e.g. the middle of a round territory). Average
  // the tied cells near the first one, so the label isn't biased toward the top-left.
  const sums = new Map<number, { x: number; y: number; count: number }>();
  for (let i = 0; i < dist.length; i++) {
    const id = cellOwner[i]!;
    const first = best.get(id);
    if (id === 0 || first === undefined || dist[i] !== dist[first]) continue;
    const reachCells = dist[first]! / 3 + 1;
    const dx = (i % cols) - (first % cols);
    const dy = Math.floor(i / cols) - Math.floor(first / cols);
    if (Math.abs(dx) > reachCells || Math.abs(dy) > reachCells) continue;
    const sum = sums.get(id) ?? { x: 0, y: 0, count: 0 };
    sum.x += (i % cols) * CELL + CELL / 2;
    sum.y += Math.floor(i / cols) * CELL + CELL / 2;
    sum.count++;
    sums.set(id, sum);
  }
  for (const [id, i] of best) {
    const sum = sums.get(id)!;
    const radius = (dist[i]! / 3) * CELL;
    const center = localCentroid(
      owner,
      width,
      height,
      id,
      sum.x / sum.count,
      sum.y / sum.count,
      radius,
    );
    placements.set(id, { x: center.x, y: center.y, radius });
  }
  return placements;
}

/**
 * The coarse grid puts a label up to half a cell off center; refine it to the centroid
 * of the owner's tiles in a square centered on the coarse point (exact for small, round
 * territories; the square is symmetric so clipping doesn't bias the result).
 */
function localCentroid(
  owner: Uint16Array,
  width: number,
  height: number,
  id: number,
  cx: number,
  cy: number,
  radius: number,
): { x: number; y: number } {
  const reach = Math.max(CELL, Math.min(radius, CELL * 3));
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const y0 = Math.max(0, Math.ceil(cy - reach - 0.5));
  const y1 = Math.min(height - 1, Math.floor(cy + reach - 0.5));
  const x0 = Math.max(0, Math.ceil(cx - reach - 0.5));
  const x1 = Math.min(width - 1, Math.floor(cx + reach - 0.5));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (owner[y * width + x] === id) {
        sumX += x + 0.5;
        sumY += y + 0.5;
        count++;
      }
    }
  }
  return count > 0 ? { x: sumX / count, y: sumY / count } : { x: cx, y: cy };
}

/** "+12K gold" rising from a captured player's land (GAME_DESIGN.md §3.16). */
export interface LootFloater {
  /** Where the captured player's label was, in tiles. */
  readonly x: number;
  readonly y: number;
  readonly gold: number;
  /** 0 → 1 over the animation. */
  readonly age: number;
  /** Captured by the local player (bigger, brighter). */
  readonly mine: boolean;
}

const LOOT_GOLD = "#ffd166";
const LOOT_RISE_PX = 46;

const MAX_NAME_PX = 26;
/** Tribes are filler: small names, so the nations' labels dominate the map (2.1 playtest). */
const MAX_TRIBE_NAME_PX = 12;
/** Troop counts are secondary: smaller than the name (2.1 playtest: "too big"). */
const TROOP_SCALE = 0.6;
/** A tribe's troop count only shows once its name is at least this big (zoomed in). */
const TRIBE_TROOPS_FROM_PX = 11;
const MIN_READABLE_PX = 9;

export class LabelLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly font: string;

  constructor(canvas: HTMLCanvasElement, fontFamily: string) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    this.context = context;
    this.font = fontFamily;
  }

  resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /** Clears the overlay; call once per animation frame before anything draws on it. */
  clear(): void {
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(
    view: MapView,
    placements: ReadonlyMap<number, LabelPlacement>,
    players: readonly LabelPlayer[],
  ): void {
    const ctx = this.context;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const halfW = this.canvas.clientWidth / 2;
    const halfH = this.canvas.clientHeight / 2;

    for (const player of players) {
      const place = placements.get(player.id);
      if (!place || !player.alive) continue;
      const sx = (place.x - view.centerX) * view.zoom + halfW;
      const sy = (place.y - view.centerY) * view.zoom + halfH;
      const radiusPx = place.radius * view.zoom;
      if (
        sx < -radiusPx ||
        sy < -radiusPx ||
        sx > halfW * 2 + radiusPx ||
        sy > halfH * 2 + radiusPx
      )
        continue;

      const weight = player.tribe ? 500 : 700;
      let size = Math.min(player.tribe ? MAX_TRIBE_NAME_PX : MAX_NAME_PX, radiusPx * 0.55);
      ctx.font = `${weight} ${size}px ${this.font}`;
      const nameWidth = ctx.measureText(player.name).width;
      if (nameWidth > radiusPx * 1.8) size *= (radiusPx * 1.8) / nameWidth;
      const alpha = Math.max(0, Math.min(1, (size - MIN_READABLE_PX) / 3));
      if (alpha <= 0) continue;

      ctx.globalAlpha = alpha;
      ctx.font = `${weight} ${size}px ${this.font}`;
      ctx.lineWidth = Math.max(2, size * 0.18);
      ctx.strokeStyle = "rgba(10, 14, 22, 0.55)";
      ctx.fillStyle =
        player.relation === "ally"
          ? ALLY_NAME
          : player.relation === "traitor"
            ? TRAITOR_NAME
            : player.tribe
              ? "rgba(255, 255, 255, 0.8)"
              : "#ffffff";
      const showTroops = !player.tribe || size >= TRIBE_TROOPS_FROM_PX;
      const nameY = showTroops ? sy - size * 0.32 : sy;
      ctx.strokeText(player.name, sx, nameY);
      ctx.fillText(player.name, sx, nameY);
      if (!showTroops) continue;

      const troopSize = size * TROOP_SCALE;
      ctx.font = `500 ${troopSize}px ${this.font}`;
      ctx.lineWidth = Math.max(2, troopSize * 0.18);
      const troopY = sy + size * 0.5;
      const troops = formatTroops(player.troops);
      ctx.strokeText(troops, sx, troopY);
      ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
      ctx.fillText(troops, sx, troopY);
    }
    ctx.globalAlpha = 1;
  }

  /** Draws loot floaters over the labels (call after draw()). */
  drawLoot(view: MapView, floaters: readonly LootFloater[]): void {
    if (floaters.length === 0) return;
    const ctx = this.context;
    const halfW = this.canvas.clientWidth / 2;
    const halfH = this.canvas.clientHeight / 2;
    for (const f of floaters) {
      const sx = (f.x - view.centerX) * view.zoom + halfW;
      const sy = (f.y - view.centerY) * view.zoom + halfH;
      if (sx < -100 || sy < -100 || sx > halfW * 2 + 100 || sy > halfH * 2 + 100) continue;
      const pop = Math.min(1, f.age * 6); // quick pop-in…
      const size = (f.mine ? 22 : 14) * (0.7 + 0.3 * pop);
      const y = sy - LOOT_RISE_PX * (1 - (1 - f.age) * (1 - f.age)); // …easing upward…
      ctx.globalAlpha = pop * Math.min(1, (1 - f.age) * 2.5); // …fading at the end
      const text = `+${formatTroops(f.gold)}`;
      ctx.font = `800 ${size}px ${this.font}`;
      const width = ctx.measureText(text).width;
      const coin = size * 0.36;
      const x = sx + coin;
      ctx.lineWidth = Math.max(2, size * 0.2);
      ctx.strokeStyle = "rgba(40, 26, 0, 0.7)";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = LOOT_GOLD;
      ctx.fillText(text, x, y);
      // A coin in front of the number.
      ctx.beginPath();
      ctx.arc(x - width / 2 - coin * 1.2, y, coin, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, size * 0.08);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
