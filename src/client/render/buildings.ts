/**
 * Building icons on the map (GAME_DESIGN.md §3.17.10): a round dark badge ringed in the
 * owner's colour, the building's drawing for its level (icons.ts — the same art as
 * the build bar), and 1–3 level pips under it; a level-III building gets a gold outer ring.
 * The tier reads without clicking. A building under construction is faded with a progress
 * ring; one being upgraded shows the ring at full strength.
 *
 * While the player is placing a building (the build bar), a ghost of it follows the mouse,
 * snapped to the tile under it, with a ring showing the spacing: green where it may go,
 * red where it may not.
 *
 * Drawn with Canvas2D on the label overlay (ARCHITECTURE.md §5.7 — instanced WebGL icons
 * can replace this if lobbies ever show thousands of buildings).
 */
import type { BuildingSnapshot } from "../../sim/frame.ts";
import type { BuildingType } from "../../sim/rules.ts";
import { iconPath } from "../icons.ts";
import type { MapView } from "./renderer.ts";

export interface BuildGhost {
  readonly type: BuildingType;
  readonly tile: number;
  readonly ok: boolean;
  /** Spacing radius in tiles. */
  readonly radius: number;
}

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
  /** The building being placed, if any. */
  readonly ghost: BuildGhost | null;
}

/** Icon size in CSS px per unit of zoom (pixels per tile), and its bounds. */
export const ICON_PX_PER_ZOOM = 8;
export const ICON_MAX_PX = 40;
/** Below this size only your own and level-III buildings are drawn (at this size). */
export const ICON_MIN_PX = 18;

const ICON_INK = "#f6f1e4";
const GOLD = "#ffd166";

/** The icon size (CSS px) at a zoom level. */
export function iconSize(zoom: number): number {
  return Math.min(ICON_MAX_PX, Math.max(ICON_MIN_PX, zoom * ICON_PX_PER_ZOOM));
}

export class BuildingLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly paths = new Map<string, Path2D>();

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
    const size = iconSize(view.zoom);
    const small = view.zoom * ICON_PX_PER_ZOOM < ICON_MIN_PX;

    for (const b of input.buildings) {
      const mine = b.owner === input.localPlayerId;
      if (small && !mine && b.level < 3) continue;
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
        : null;
      this.badge(at.x, at.y, size, b.type, b.level, {
        color: input.colorOf(b.owner),
        mine,
        progress,
        selected: b.id === input.selectedId,
      });
    }

    const ghost = input.ghost;
    if (ghost) {
      const at = toScreen(ghost.tile);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ghost.ok ? "rgba(140, 240, 190, 0.95)" : "rgba(255, 120, 100, 0.95)";
      ctx.fillStyle = ghost.ok ? "rgba(140, 240, 190, 0.08)" : "rgba(255, 120, 100, 0.1)";
      ctx.beginPath();
      ctx.arc(at.x, at.y, Math.max(size * 0.7, ghost.radius * view.zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.85;
      this.badge(at.x, at.y, Math.max(26, size), ghost.type, 1, {
        color: ghost.ok ? "#8cf0be" : "#ff7864",
        mine: true,
        progress: null,
        selected: false,
        pips: false,
      });
      ctx.restore();
    }
  }

  private path(type: BuildingType, level: number): Path2D {
    const key = `${type}:${level}`;
    let path = this.paths.get(key);
    if (!path) {
      path = new Path2D(iconPath(type, level));
      this.paths.set(key, path);
    }
    return path;
  }

  private badge(
    x: number,
    y: number,
    size: number,
    type: BuildingType,
    level: number,
    style: {
      color: string;
      mine: boolean;
      /** Construction/upgrade progress 0..1, or null when idle. */
      progress: number | null;
      selected: boolean;
      pips?: boolean;
    },
  ): void {
    const ctx = this.context;
    const r = size / 2;
    ctx.save();
    if (level === 0) ctx.globalAlpha *= 0.6; // first construction: not working yet

    // A soft shadow lifts the badge off the map.
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = size * 0.25;
    ctx.shadowOffsetY = size * 0.06;
    const fill = ctx.createRadialGradient(x, y - r * 0.4, r * 0.1, x, y, r);
    fill.addColorStop(0, "#2a3346");
    fill.addColorStop(1, "#0e121a");
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = "transparent";

    ctx.lineWidth = style.selected ? 3 : style.mine ? 2.4 : 1.8;
    ctx.strokeStyle = style.selected ? "#ffffff" : style.color;
    ctx.stroke();
    if (level >= 3) {
      ctx.beginPath();
      ctx.arc(x, y, r + 2.6, 0, Math.PI * 2);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = GOLD;
      ctx.stroke();
    }

    // The drawing: 24 × 24 art scaled into ~62% of the badge.
    const scale = (size * 0.62) / 24;
    ctx.translate(x - 12 * scale, y - 12 * scale - size * 0.01);
    ctx.scale(scale, scale);
    ctx.fillStyle = ICON_INK;
    ctx.fill(this.path(type, level), "evenodd");
    ctx.restore();

    if (style.pips !== false && level > 0) {
      const pip = Math.max(2.2, size * 0.085);
      const gap = pip * 2.7;
      const py = y + r + pip + 2.5;
      ctx.save();
      for (let k = 0; k < level; k++) {
        ctx.beginPath();
        ctx.arc(x + (k - (level - 1) / 2) * gap, py, pip, 0, Math.PI * 2);
        ctx.fillStyle = style.mine ? GOLD : "#ffffff";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(10, 14, 22, 0.75)";
        ctx.stroke();
      }
      ctx.restore();
    }

    if (style.progress !== null) {
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
      ctx.beginPath();
      ctx.arc(x, y, r + 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = GOLD;
      ctx.beginPath();
      ctx.arc(x, y, r + 4.5, -Math.PI / 2, -Math.PI / 2 + style.progress * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
