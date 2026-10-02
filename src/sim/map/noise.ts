/**
 * Deterministic 2D gradient noise for map generation. Lattice gradients come from an
 * integer hash of the cell coordinates and a seed, and interpolation is polynomial,
 * so the result is identical on every engine (no Math.sin or Math.random).
 */
import { mix32 } from "../math/hash.ts";

// Eight unit gradient directions (axis-aligned and diagonal).
const D = 0.7071067811865476;
const GRADIENT_X = [1, D, 0, -D, -1, -D, 0, D];
const GRADIENT_Y = [0, D, 1, D, 0, -D, -1, -D];

function gradientDot(seed: number, ix: number, iy: number, dx: number, dy: number): number {
  const h = mix32(Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed) & 7;
  return GRADIENT_X[h]! * dx + GRADIENT_Y[h]! * dy;
}

/** Quintic fade 6t⁵ − 15t⁴ + 10t³: smooth first and second derivatives at cell edges. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Gradient noise at (x, y); roughly in [-0.7, 0.7], 0 at lattice points. */
export function gradientNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fade(fx);
  const v = fade(fy);
  const n00 = gradientDot(seed, x0, y0, fx, fy);
  const n10 = gradientDot(seed, x0 + 1, y0, fx - 1, fy);
  const n01 = gradientDot(seed, x0, y0 + 1, fx, fy - 1);
  const n11 = gradientDot(seed, x0 + 1, y0 + 1, fx - 1, fy - 1);
  const top = n00 + u * (n10 - n00);
  const bottom = n01 + u * (n11 - n01);
  return top + v * (bottom - top);
}

/**
 * Fractal noise: `octaves` layers of gradient noise, each at double the frequency and
 * `gain` times the amplitude of the previous one. Normalized to roughly [-0.7, 0.7].
 */
export function fractalNoise(
  seed: number,
  x: number,
  y: number,
  octaves: number,
  gain = 0.5,
): number {
  let sum = 0;
  let amplitude = 1;
  let totalAmplitude = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * gradientNoise(mix32(seed + octave), x * frequency, y * frequency);
    totalAmplitude += amplitude;
    amplitude *= gain;
    frequency *= 2;
  }
  return sum / totalAmplitude;
}

/** Ridged fractal noise in [0, 1]: sharp crests where the noise crosses zero (mountain chains). */
export function ridgedNoise(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let totalAmplitude = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    const n = gradientNoise(mix32(seed + 7919 * (octave + 1)), x * frequency, y * frequency);
    const ridge = 1 - Math.min(1, Math.abs(n) * 1.6);
    sum += amplitude * ridge * ridge;
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / totalAmplitude;
}
