/**
 * Map markers (GAME_DESIGN.md §3.20, milestone 2.9): friends' pings (a pulsing ring with the
 * ping's icon and who sent it), incoming threats (a red ring where they will hit, with the
 * seconds left), arrows at the screen edge for either when it is off screen, and emoji
 * bubbles over their senders' land.
 *
 * Drawn with Canvas2D on the label overlay, after everything else so they stay on top.
 */
import type { MapView } from "./renderer.ts";

export interface PingMarker {
  readonly tile: number;
  readonly icon: string;
  /** Shown under the ring for a few seconds, e.g. "Prussia: Attack here". */
  readonly label: string;
  /** Ring colour (the ping kind) and dot colour (the sender). */
  readonly color: string;
  readonly senderColor: string;
  /** 0 → 1 over the ping's life. */
  readonly age: number;
}

export interface ThreatMarker {
  readonly tile: number;
  readonly icon: string;
  readonly secondsLeft: number;
}

export interface EmoteBubble {
  /** Where (tile coordinates): above the sender's name label. */
  readonly x: number;
  readonly y: number;
  /** The label's radius in tiles (the bubble sits above the name). */
  readonly radius: number;
  readonly emoji: string;
  /** 0 → 1 over its showing time. */
  readonly age: number;
  /** Sent to the local player (gets a ring in the sender's colour). */
  readonly toMe: boolean;
  readonly senderColor: string;
}

export interface MarkerDrawInput {
  readonly width: number;
  readonly pings: readonly PingMarker[];
  readonly threats: readonly ThreatMarker[];
  readonly emotes: readonly EmoteBubble[];
  /** Seconds, for the pulses. */
  readonly time: number;
}

const THREAT = "#ff5a48";
/**
 * Edge arrows sit this far inside the screen edges (CSS px) — more at the top and bottom,
 * to stay clear of the top chips and the command bar.
 */
const EDGE_SIDE = 30;
const EDGE_TOP = 64;
const EDGE_BOTTOM = 200;

export class MarkerLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly fontFamily: string;

  constructor(canvas: HTMLCanvasElement, fontFamily: string) {
    this.canvas = canvas;
    this.fontFamily = fontFamily;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    this.context = context;
  }

  draw(view: MapView, input: MarkerDrawInput): void {
    const ctx = this.context;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const tileScreen = (tile: number) => ({
      x: ((tile % input.width) + 0.5 - view.centerX) * view.zoom + w / 2,
      y: (Math.floor(tile / input.width) + 0.5 - view.centerY) * view.zoom + h / 2,
    });
    const onScreen = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;

    for (const bubble of input.emotes) {
      const x = (bubble.x - view.centerX) * view.zoom + w / 2;
      const y = (bubble.y - view.centerY) * view.zoom + h / 2;
      const lift = Math.max(22, Math.min(60, bubble.radius * view.zoom * 0.45 + 18));
      if (x < -40 || x > w + 40 || y - lift < -40 || y - lift > h + 40) continue;
      this.emote(x, y - lift, bubble);
    }

    for (const threat of input.threats) {
      const p = tileScreen(threat.tile);
      if (onScreen(p)) this.threat(p.x, p.y, threat, input.time);
      else this.edgeArrow(p.x, p.y, w, h, THREAT, threat.icon, `${Math.ceil(threat.secondsLeft)}s`);
    }

    for (const ping of input.pings) {
      const p = tileScreen(ping.tile);
      if (onScreen(p)) this.ping(p.x, p.y, ping, input.time);
      else this.edgeArrow(p.x, p.y, w, h, ping.color, ping.icon, null);
    }
  }

  private ping(x: number, y: number, ping: PingMarker, time: number): void {
    const ctx = this.context;
    const fade = ping.age > 0.85 ? (1 - ping.age) / 0.15 : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    // Two rings expanding outward, half a beat apart.
    for (const offset of [0, 0.5]) {
      const phase = (time * 0.9 + offset) % 1;
      ctx.beginPath();
      ctx.arc(x, y, 8 + phase * 22, 0, Math.PI * 2);
      ctx.strokeStyle = ping.color;
      ctx.globalAlpha = fade * (1 - phase) * 0.9;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = ping.senderColor;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
    ctx.font = `20px ${this.fontFamily}`;
    ctx.fillText(ping.icon, x, y - 24);
    if (ping.age < 0.5) {
      ctx.font = `650 12px ${this.fontFamily}`;
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(10,14,20,0.85)";
      ctx.strokeText(ping.label, x, y + 22);
      ctx.fillStyle = "#f4f1e8";
      ctx.fillText(ping.label, x, y + 22);
    }
    ctx.restore();
  }

  private threat(x: number, y: number, threat: ThreatMarker, time: number): void {
    const ctx = this.context;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 13 + pulse * 3, 0, Math.PI * 2);
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = THREAT;
    ctx.globalAlpha = 0.65 + 0.35 * pulse;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.font = `700 12px ${this.fontFamily}`;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(10,14,20,0.85)";
    const text = `${threat.icon} ${Math.ceil(threat.secondsLeft)} s`;
    ctx.strokeText(text, x, y - 26);
    ctx.fillStyle = "#ffd6cf";
    ctx.fillText(text, x, y - 26);
    ctx.restore();
  }

  /** An arrow just inside the screen edge, pointing at an off-screen point. */
  private edgeArrow(
    px: number,
    py: number,
    w: number,
    h: number,
    color: string,
    icon: string,
    text: string | null,
  ): void {
    const ctx = this.context;
    const top = EDGE_TOP;
    const bottom = Math.max(top + 40, h - EDGE_BOTTOM);
    const cx = w / 2;
    const cy = (top + bottom) / 2;
    const dx = px - cx;
    const dy = py - cy;
    // Scale the direction from the box's centre until it touches the box.
    const sx = dx === 0 ? Infinity : (w / 2 - EDGE_SIDE) / Math.abs(dx);
    const sy = dy === 0 ? Infinity : (bottom - top) / 2 / Math.abs(dy);
    const s = Math.min(1, sx, sy);
    const x = cx + dx * s;
    const y = cy + dy * s;
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(14,18,26,0.82)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(14, -6);
    ctx.lineTo(14, 6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.rotate(-angle);
    ctx.font = `14px ${this.fontFamily}`;
    ctx.fillStyle = "#fff";
    ctx.fillText(icon, 0, 1);
    if (text) {
      ctx.font = `700 11px ${this.fontFamily}`;
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(10,14,20,0.9)";
      // Under the arrow, or above it at the bottom edge.
      const ty = y > bottom - 4 ? -24 : 24;
      ctx.strokeText(text, 0, ty);
      ctx.fillStyle = color;
      ctx.fillText(text, 0, ty);
    }
    ctx.restore();
  }

  private emote(x: number, y: number, bubble: EmoteBubble): void {
    const ctx = this.context;
    // Pop in (first 8%), float up a little, fade out (last 20%).
    const pop = Math.min(1, bubble.age / 0.08);
    const scale = 0.6 + 0.4 * (1 - (1 - pop) ** 3);
    const fade = bubble.age > 0.8 ? (1 - bubble.age) / 0.2 : 1;
    const rise = bubble.age * 8;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(x, y - rise);
    ctx.scale(scale, scale);
    const r = 17;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.moveTo(-5, r - 2);
    ctx.lineTo(0, r + 7);
    ctx.lineTo(5, r - 2);
    ctx.fillStyle = "rgba(246,243,236,0.95)";
    ctx.fill();
    if (bubble.toMe) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = bubble.senderColor;
      ctx.stroke();
    }
    ctx.font = `20px ${this.fontFamily}`;
    ctx.fillStyle = "#000";
    ctx.fillText(bubble.emoji, 0, 1);
    ctx.restore();
  }
}
