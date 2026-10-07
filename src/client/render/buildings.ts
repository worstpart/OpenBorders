/**
 * Building icons on the map (GAME_DESIGN.md §3.17.10): a round dark badge ringed in the
 * owner's colour, the painted sprite for its level (sprites.ts, the user's icon pack — D-028;
 * the same art as the build bar), and 1–3 level pips under it; a level-III building gets a
 * gold outer ring.
 * The tier reads without clicking. A building under construction is faded with a progress
 * ring; one being upgraded shows the ring at full strength.
 *
 * While the player is placing a building (the build bar), a ghost of it follows the mouse,
 * snapped to the tile under it, with a ring showing the spacing: green where it may go,
 * red where it may not.
 *
 * Range rings (GAME_DESIGN.md §3.17.7) go under everything: a SAM's radius while its card is
 * open, every SAM's in the air defence view (key V), while placing a SAM, or the hostile ones
 * while aiming an airlift — yours light, friends' blue, everyone else's red — each with its
 * ready interceptors as small marks on the rim; the ghost of a SAM being placed shows its
 * radius too.
 *
 * Walls (GAME_DESIGN.md §3.17.6, D-024) are drawn here too, under the icons: each run of
 * standing tiles as a thick line through the tile centres — a palisade of stakes (I), a
 * stone wall with blocks (II), a fortress wall with merlons (III) — with towers at the
 * corner points. A wall being built is a dashed outline; the wall being drawn shows its
 * points A, B, C …, the line to the mouse, its length and price, green or red.
 *
 * Drawn with Canvas2D on the label overlay (ARCHITECTURE.md §5.7 — instanced WebGL icons
 * can replace this if lobbies ever show thousands of buildings).
 */
import type { BuildingSnapshot, WallSnapshot } from "../../sim/frame.ts";
import type { BuildingType } from "../../sim/rules.ts";
import type { WallPreview } from "../app/buildings.ts";
import { formatTroops } from "../format.ts";
import { iconPath } from "../icons.ts";
import { drawSprite, sprites } from "../sprites.ts";
import type { MapView } from "./renderer.ts";

export interface BuildGhost {
  readonly type: BuildingType;
  readonly tile: number;
  readonly ok: boolean;
  /** Spacing radius in tiles. */
  readonly radius: number;
  /** What it would reach (a SAM's radius), in tiles; 0 for none. */
  readonly reach: number;
}

/** A range ring on the map: a SAM's radius, or the range of the Airport whose card is open. */
export interface RangeRing {
  readonly tile: number;
  /** Radius in tiles. */
  readonly radius: number;
  readonly tone: "mine" | "friend" | "hostile";
  /** A SAM's interceptors: ready ones, of `max` (max 0: not a SAM). */
  readonly ready: number;
  readonly max: number;
}

const RING_COLORS: Readonly<Record<RangeRing["tone"], { line: string; fill: string }>> = {
  mine: { line: "rgba(246, 241, 228, 0.75)", fill: "rgba(246, 241, 228, 0.05)" },
  friend: { line: "rgba(120, 180, 255, 0.8)", fill: "rgba(120, 180, 255, 0.06)" },
  hostile: { line: "rgba(255, 110, 90, 0.85)", fill: "rgba(255, 110, 90, 0.08)" },
};

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
  /** Every wall, the one whose card is open, and the wall being drawn (if any). */
  readonly walls: readonly WallSnapshot[];
  readonly selectedWall: number | null;
  readonly wallPreview: WallPreview | null;
  /** The building being placed, if any. */
  readonly ghost: BuildGhost | null;
  /** Range rings to show now (see the header). */
  readonly rings: readonly RangeRing[];
}

/** Icon size in CSS px per unit of zoom (pixels per tile), and its bounds. */
export const ICON_PX_PER_ZOOM = 8;
export const ICON_MAX_PX = 48;
/** Below this size only your own and level-III buildings keep their icon (at this size); others are dots. */
export const ICON_MIN_PX = 18;

const ICON_INK = "#f6f1e4";
/** A building sprite's width, in badge diameters. */
const SPRITE_WIDTH = 1.12;
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
    sprites.preload();
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

    const width = halfW * 2;
    const height = halfH * 2;
    for (const ring of input.rings) {
      const at = toScreen(ring.tile);
      const r = ring.radius * view.zoom;
      if (at.x < -r || at.y < -r || at.x > width + r || at.y > height + r) continue;
      this.ring(at.x, at.y, r, ring);
    }
    for (const wall of input.walls) {
      this.wall(wall, toScreen, view.zoom, input, width, height);
    }
    if (input.wallPreview) this.wallDraft(input.wallPreview, toScreen, view.zoom);

    for (const b of input.buildings) {
      const mine = b.owner === input.localPlayerId;
      const at = toScreen(b.tile);
      if (at.x < -size || at.y < -size || at.x > halfW * 2 + size || at.y > halfH * 2 + size) {
        continue;
      }
      // Zoomed out, other players' level I–II buildings shrink to a dot (still visible,
      // without cluttering the map); yours and level III keep their icon.
      if (small && !mine && b.level < 3) {
        this.dot(at.x, at.y, input.colorOf(b.owner), b.level);
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
      if (ghost.reach > 0) {
        // What it would cover (a SAM's radius): fainter, so the spacing ring still reads.
        ctx.setLineDash([2, 5]);
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = ghost.ok ? "rgba(140, 240, 190, 0.05)" : "rgba(255, 120, 100, 0.04)";
        ctx.beginPath();
        ctx.arc(at.x, at.y, ghost.reach * view.zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
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

  /** A range ring with its SAM's ready interceptors as marks along the top of the rim. */
  private ring(x: number, y: number, r: number, ring: RangeRing): void {
    const ctx = this.context;
    const colors = RING_COLORS[ring.tone];
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors.fill;
    ctx.fill();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = "rgba(10, 14, 20, 0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colors.line;
    ctx.stroke();
    ctx.setLineDash([]);
    if (ring.max > 0 && r > 24) {
      // One mark per interceptor on the rim's top: filled = ready.
      const step = Math.min(0.12, 14 / r);
      for (let k = 0; k < ring.max; k++) {
        const angle = -Math.PI / 2 + (k - (ring.max - 1) / 2) * step;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = k < ring.ready ? colors.line : "rgba(14, 18, 26, 0.9)";
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = colors.line;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** A far-zoom building marker: a dark dot ringed in the owner's colour (bigger per level). */
  private dot(x: number, y: number, color: string, level: number): void {
    const ctx = this.context;
    const r = level >= 2 ? 4.5 : 3.5;
    ctx.save();
    if (level === 0) ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#0e121a";
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 1.3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd166";
    ctx.fill();
    ctx.restore();
  }

  /** One wall: its runs of standing tiles, by level (see the header). */
  private wall(
    wall: WallSnapshot,
    toScreen: (tile: number) => { x: number; y: number },
    zoom: number,
    input: BuildingDrawInput,
    width: number,
    height: number,
  ): void {
    const runs = wallRuns(wall.tiles, input.width);
    if (runs.length === 0) return;
    const points = runs.map((run) => run.map(toScreen));
    // Skip walls entirely off screen.
    let visible = false;
    for (const run of points) {
      for (const p of run) {
        if (p.x > -40 && p.y > -40 && p.x < width + 40 && p.y < height + 40) visible = true;
      }
    }
    if (!visible) return;
    const ctx = this.context;
    const level = wall.level;
    const owner = input.colorOf(wall.owner);
    const selected = wall.id === input.selectedWall;
    const w = Math.min(Math.max(zoom * 0.7, 3 + level * 1.5), 6 + level * 6);
    const trace = (run: { x: number; y: number }[]) => {
      ctx.beginPath();
      ctx.moveTo(run[0]!.x, run[0]!.y);
      for (const p of run.slice(1)) ctx.lineTo(p.x, p.y);
      if (run.length === 1) ctx.lineTo(run[0]!.x + 0.01, run[0]!.y);
    };
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const run of points) {
      if (level === 0) {
        // Under construction: a dashed outline in the owner's colour.
        trace(run);
        ctx.setLineDash([w * 0.9, w * 0.7]);
        ctx.lineWidth = Math.max(2, w * 0.6);
        ctx.strokeStyle = "rgba(15, 18, 24, 0.55)";
        ctx.stroke();
        ctx.lineWidth = Math.max(1, w * 0.3);
        ctx.strokeStyle = owner;
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      // Shadow/outline, then the owner's colour as a thin base, then the stone/wood.
      trace(run);
      ctx.lineWidth = w + 3 + (selected ? 3 : 0);
      ctx.strokeStyle = selected ? "#ffffff" : "rgba(12, 14, 20, 0.85)";
      ctx.stroke();
      ctx.lineWidth = w + 1;
      ctx.strokeStyle = owner;
      ctx.stroke();
      ctx.lineWidth = w - 1;
      ctx.strokeStyle = level === 1 ? "#8a5a2b" : level === 2 ? "#a9a49a" : "#d9d3c4";
      ctx.stroke();
      // Texture: stakes (I), block joints (II), merlons (III).
      ctx.lineCap = "butt";
      if (level === 1) {
        ctx.setLineDash([Math.max(2, w * 0.35), Math.max(1.5, w * 0.25)]);
        ctx.lineWidth = Math.max(1, w * 0.45);
        ctx.strokeStyle = "#c8945a";
      } else if (level === 2) {
        ctx.setLineDash([Math.max(3, w * 0.9), Math.max(1, w * 0.18)]);
        ctx.lineWidth = Math.max(1, w * 0.55);
        ctx.strokeStyle = "#cfcabd";
      } else {
        ctx.setLineDash([Math.max(2.5, w * 0.55), Math.max(2.5, w * 0.55)]);
        ctx.lineWidth = w + 1;
        ctx.strokeStyle = "#f2ede0";
      }
      trace(run);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = "round";
    }
    // Towers at the ends of each run (II and III).
    if (level >= 2) {
      for (const run of points) {
        for (const p of [run[0]!, run.at(-1)!]) {
          const r = w * (level === 3 ? 0.95 : 0.75);
          ctx.fillStyle = "rgba(12, 14, 20, 0.85)";
          ctx.fillRect(p.x - r - 1.5, p.y - r - 1.5, 2 * r + 3, 2 * r + 3);
          ctx.fillStyle = level === 3 ? "#f2ede0" : "#cfcabd";
          ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
          ctx.fillStyle = owner;
          ctx.fillRect(p.x - r * 0.45, p.y - r * 0.45, r * 0.9, r * 0.9);
        }
      }
    }
    // Construction / upgrade progress next to the wall's middle.
    if (wall.readyTick >= 0) {
      const progress = Math.min(
        1,
        Math.max(0, (input.tick - wall.startTick) / Math.max(1, wall.readyTick - wall.startTick)),
      );
      const longest = points.reduce((a, b) => (b.length > a.length ? b : a));
      const mid = longest[Math.floor(longest.length / 2)]!;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y - w - 8, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(14, 18, 26, 0.85)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mid.x, mid.y - w - 8, 6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = GOLD;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The wall being drawn: the line through its points and the mouse, labelled A, B, C … */
  private wallDraft(
    draft: WallPreview,
    toScreen: (tile: number) => { x: number; y: number },
    zoom: number,
  ): void {
    const ctx = this.context;
    const ok = draft.problem === null;
    const color = ok ? "rgba(140, 240, 190, 0.95)" : "rgba(255, 120, 100, 0.95)";
    const w = Math.max(4, Math.min(zoom * 0.7, 14));
    ctx.save();
    // The tiles it would cover, then the straight pieces between the points.
    ctx.fillStyle = ok ? "rgba(140, 240, 190, 0.35)" : "rgba(255, 120, 100, 0.35)";
    for (const t of draft.tiles) {
      const p = toScreen(t);
      const s = Math.max(2, zoom);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    const pts = draft.points.map(toScreen);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([w, w * 0.6]);
    ctx.lineWidth = w * 0.5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Corner points with their letters (the last one follows the mouse).
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    pts.forEach((p, k) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(14, 18, 26, 0.9)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String.fromCharCode(65 + k), p.x, p.y + 0.5);
    });
    // Length and price by the mouse.
    if (draft.newTiles > 0 && pts.length >= 2) {
      const last = pts.at(-1)!;
      const text = `${draft.newTiles} tiles · ${formatTroops(draft.price)}`;
      ctx.font = "600 12px Inter, system-ui, sans-serif";
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(14, 18, 26, 0.85)";
      ctx.fillRect(last.x + 12, last.y + 10, tw + 12, 20);
      ctx.fillStyle = ok ? "#ffffff" : "#ff9a8a";
      ctx.textAlign = "left";
      ctx.fillText(text, last.x + 18, last.y + 20.5);
    }
    ctx.restore();
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

    // The painted sprite for its level (sprites.ts), a little wider than the badge so the
    // art reads; the line drawing (icons.ts) until the image has loaded.
    if (!drawSprite(ctx, type, level, x, y - size * 0.02, size * SPRITE_WIDTH)) {
      const scale = (size * 0.62) / 24;
      ctx.translate(x - 12 * scale, y - 12 * scale - size * 0.01);
      ctx.scale(scale, scale);
      ctx.fillStyle = ICON_INK;
      ctx.fill(this.path(type, level), "evenodd");
    }
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

/** Splits a wall's standing tiles (in build order) into runs of 8-connected neighbours. */
export function wallRuns(tiles: readonly number[], width: number): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  for (const t of tiles) {
    const prev = run.at(-1);
    if (
      prev !== undefined &&
      (Math.abs((t % width) - (prev % width)) > 1 ||
        Math.abs(Math.floor(t / width) - Math.floor(prev / width)) > 1)
    ) {
      runs.push(run);
      run = [];
    }
    run.push(t);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}
