/**
 * Explosion particles (the user's request during 2B.5): every explosion on the map — a SAM or
 * flak hit on a plane or missile, an air strike landing, a building hit by a strike or a
 * missile, a strike missile, a bunker buster and the strategic warhead — throws out sparks,
 * fire, smoke and debris.
 *
 * Purely visual and client-side (Math.random is fine here; the simulation never sees any of
 * it). Particles live in map coordinates (tiles), so they stay put when the camera pans, and
 * their sizes grow with the zoom (within limits). At most MAX_PARTICLES are alive: a new
 * explosion past that replaces the oldest particles, so a big battle can't slow the frame.
 */

/** The explosions there are, smallest to biggest. */
export type ExplosionKind =
  "intercept" | "strike" | "building" | "destroyed" | "missile" | "warhead";

type ParticleType = "spark" | "fire" | "smoke" | "debris" | "ring";

interface Particle {
  type: ParticleType;
  /** Position (tiles) and velocity (tiles per second). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** When it appears and how long it lives (ms, performance.now()). */
  start: number;
  life: number;
  /** Size in screen px at zoom 4 (scaled with the zoom when drawn). */
  size: number;
  /** How fast it slows down (share of its speed lost per second). */
  drag: number;
  /** Screen-down pull (tiles/s²): debris arcs and falls, smoke and fire rise (negative). */
  gravity: number;
}

interface Preset {
  /** Radius (tiles) the burst spreads over. */
  readonly reach: number;
  readonly sparks: number;
  readonly fire: number;
  readonly smoke: number;
  readonly debris: number;
  /** A shock ring (radius in tiles; 0: none). */
  readonly ring: number;
  /** Bigger blobs. */
  readonly scale: number;
}

const PRESETS: Readonly<Record<ExplosionKind, Preset>> = {
  intercept: { reach: 1.6, sparks: 14, fire: 7, smoke: 6, debris: 5, ring: 0, scale: 0.8 },
  building: { reach: 2.2, sparks: 14, fire: 10, smoke: 9, debris: 9, ring: 0, scale: 1 },
  strike: { reach: 3, sparks: 22, fire: 14, smoke: 12, debris: 10, ring: 2.5, scale: 1 },
  destroyed: { reach: 3.2, sparks: 24, fire: 18, smoke: 16, debris: 16, ring: 3, scale: 1.2 },
  missile: { reach: 5, sparks: 34, fire: 26, smoke: 22, debris: 16, ring: 8, scale: 1.4 },
  warhead: { reach: 14, sparks: 70, fire: 90, smoke: 80, debris: 30, ring: 20, scale: 2.4 },
};

export const MAX_PARTICLES = 2500;

export class ParticleSystem {
  private particles: Particle[] = [];

  /** True while anything is still showing (the overlay must keep drawing). */
  get active(): boolean {
    return this.particles.length > 0;
  }

  get count(): number {
    return this.particles.length;
  }

  clear(): void {
    this.particles = [];
  }

  /**
   * An explosion of `kind` centred on (x, y) in tiles, starting `delayMs` from `now` (a SAM's
   * streak reaches the plane first).
   */
  explode(kind: ExplosionKind, x: number, y: number, now: number, delayMs = 0): void {
    const p = PRESETS[kind];
    const start = now + delayMs;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const burst = (
      type: ParticleType,
      count: number,
      speed: [number, number],
      life: [number, number],
      size: [number, number],
      drag: number,
      gravity: number,
      spread = 0.15,
    ) => {
      for (let k = 0; k < count; k++) {
        const angle = Math.random() * Math.PI * 2;
        const v = rand(speed[0], speed[1]) * p.reach;
        const offset = Math.random() * p.reach * spread;
        this.particles.push({
          type,
          x: x + Math.cos(angle) * offset,
          y: y + Math.sin(angle) * offset,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v,
          start: start + rand(0, type === "smoke" ? 180 : 60),
          life: rand(life[0], life[1]) * (kind === "warhead" ? 2.2 : 1),
          size: rand(size[0], size[1]) * p.scale,
          drag,
          gravity,
        });
      }
    };
    // Sparks race out and die fast; fire blooms and rises; smoke spreads, rises and lingers;
    // debris flies out in arcs.
    burst("spark", p.sparks, [1.6, 3.2], [250, 550], [1.5, 2.6], 2.2, 0);
    burst("fire", p.fire, [0.3, 1.1], [450, 900], [5, 11], 2.5, -0.35 * p.reach);
    burst("smoke", p.smoke, [0.15, 0.6], [1100, 2200], [7, 15], 1.4, -0.25 * p.reach, 0.35);
    burst("debris", p.debris, [1, 2.2], [500, 900], [1.6, 3], 1, 2.2 * p.reach);
    if (p.ring > 0) {
      this.particles.push({
        type: "ring",
        x,
        y,
        vx: 0,
        vy: 0,
        start,
        life: kind === "warhead" ? 1400 : 600,
        size: p.ring,
        drag: 0,
        gravity: 0,
      });
    }
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }

  /**
   * Draws every living particle and forgets the dead. `toScreen` maps tile coordinates to the
   * screen; `zoom` is screen px per tile.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    toScreen: (x: number, y: number) => { x: number; y: number },
    zoom: number,
    now: number,
    width: number,
    height: number,
  ): void {
    if (this.particles.length === 0) return;
    const scale = Math.min(2, Math.max(0.5, zoom / 4));
    const alive: Particle[] = [];
    ctx.save();
    // Smoke first, so the fire, sparks and debris show on top of it.
    for (const pass of [0, 1])
      for (const particle of this.particles) {
        if ((particle.type === "smoke") !== (pass === 0)) continue;
        const age = now - particle.start;
        if (age > particle.life) continue;
        alive.push(particle);
        if (age < 0) continue;
        const t = age / particle.life;
        const s = age / 1000;
        // Distance travelled with exponential drag: v·(1 − e^(−drag·t)) / drag.
        const travel = particle.drag > 0 ? (1 - Math.exp(-particle.drag * s)) / particle.drag : s;
        const x = particle.x + particle.vx * travel;
        const y = particle.y + particle.vy * travel + 0.5 * particle.gravity * s * s;
        const p = toScreen(x, y);
        if (particle.type === "ring") {
          const r = particle.size * zoom * (0.2 + 0.8 * Math.sqrt(t));
          if (p.x + r < 0 || p.y + r < 0 || p.x - r > width || p.y - r > height) continue;
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = 0.55 * (1 - t);
          ctx.lineWidth = Math.max(1.5, 3 * scale * (1 - t));
          ctx.strokeStyle = "rgb(255, 200, 130)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }
        const size = Math.max(1, particle.size * scale);
        if (p.x < -size * 3 || p.y < -size * 3 || p.x > width + size * 3 || p.y > height + size * 3)
          continue;
        if (particle.type === "spark") {
          // A short streak along its motion.
          const speed = Math.exp(-particle.drag * s);
          const tail = toScreen(x - particle.vx * 0.04 * speed, y - particle.vy * 0.04 * speed);
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = t < 0.4 ? "rgb(255, 250, 220)" : "rgb(255, 190, 90)";
          ctx.lineWidth = size;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(tail.x, tail.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else if (particle.type === "fire") {
          const r = size * (0.6 + 0.8 * t);
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = 0.85 * (1 - t);
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          glow.addColorStop(0, t < 0.3 ? "rgba(255, 245, 200, 1)" : "rgba(255, 200, 90, 1)");
          glow.addColorStop(0.5, "rgba(255, 120, 40, 0.8)");
          glow.addColorStop(1, "rgba(200, 50, 20, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        } else if (particle.type === "smoke") {
          const r = size * (0.7 + 1.1 * t);
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 0.3 * (1 - t) * Math.min(1, t * 6);
          ctx.fillStyle = "rgb(105, 100, 96)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1 - t * t;
          ctx.fillStyle = t < 0.25 ? "rgb(255, 170, 80)" : "rgb(40, 34, 30)";
          ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        }
      }
    ctx.restore();
    this.particles = alive;
  }
}
