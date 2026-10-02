/**
 * Builds the static terrain texture once per map: a restrained natural palette
 * (GAME_DESIGN.md §5.3) in RGB, and a hillshade factor in alpha so relief stays visible
 * under territory colors (the shader multiplies the final color by it).
 *
 * Water is colored by distance to the coast (shallow → deep), so the open ocean is one
 * calm color that blends seamlessly into the area outside the map.
 */
import { Terrain, type GameMap } from "../../sim/map/gameMap.ts";

type Rgb = readonly [number, number, number];

const WATER_SHALLOW: Rgb = [74, 122, 154];
const WATER_DEEP: Rgb = [27, 50, 76];
const PLAINS_LOW: Rgb = [136, 166, 112];
const PLAINS_HIGH: Rgb = [160, 174, 120];
const HIGHLAND_LOW: Rgb = [182, 170, 132];
const HIGHLAND_HIGH: Rgb = [198, 188, 154];
const MOUNTAIN_LOW: Rgb = [150, 146, 140];
const MOUNTAIN_PEAK: Rgb = [228, 226, 222];

/** Deepest water color; also used for everything outside the map. */
export const OCEAN_COLOR: Rgb = WATER_DEEP;

/** Water reaches full depth this many tiles from the coast. */
const COAST_FADE_TILES = 22;
/** Shade 1.0 is stored as 128 so the shader can brighten (up to ~2×) as well as darken. */
export const SHADE_ONE = 128;
/** Relief is blurred over this radius (tiles) before shading, so hills read as hills, not grain. */
const SHADE_BLUR_RADIUS = 3;
const SHADE_GAIN = 0.011;
const SHADE_LIMIT = 0.2;

export function buildTerrainTexels(map: GameMap): Uint8Array {
  const { width, height, terrain, relief } = map;
  const coastDistance = distanceToLand(map, COAST_FADE_TILES);
  const smoothRelief = blurredLandRelief(map, SHADE_BLUR_RADIUS);
  const texels = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = y * width + x;
      const r = relief[tile]! / 255;
      let color: Rgb;
      let shade = 1;
      switch (terrain[tile]) {
        case Terrain.Water: {
          const depth = coastDistance[tile]! / COAST_FADE_TILES;
          color = mix(WATER_SHALLOW, WATER_DEEP, Math.sqrt(depth));
          break;
        }
        case Terrain.Plains:
          color = mix(PLAINS_LOW, PLAINS_HIGH, r * 1.6);
          break;
        case Terrain.Highland:
          color = mix(HIGHLAND_LOW, HIGHLAND_HIGH, r);
          break;
        default:
          color = mix(MOUNTAIN_LOW, MOUNTAIN_PEAK, smoothstep(0.78, 1, r));
          break;
      }
      if (terrain[tile] !== Terrain.Water) shade = hillshade(smoothRelief, width, height, x, y);
      const o = tile * 4;
      texels[o] = color[0];
      texels[o + 1] = color[1];
      texels[o + 2] = color[2];
      texels[o + 3] = Math.round(shade * SHADE_ONE);
    }
  }
  return texels;
}

/** Breadth-first distance (in tiles, 4-connected) from each water tile to land, capped. */
function distanceToLand(map: GameMap, cap: number): Uint8Array {
  const { width, height, terrain } = map;
  const distance = new Uint8Array(width * height).fill(cap);
  const queue = new Int32Array(width * height);
  let tail = 0;
  for (let tile = 0; tile < terrain.length; tile++) {
    if (terrain[tile] !== Terrain.Water) {
      distance[tile] = 0;
      queue[tail++] = tile;
    }
  }
  for (let head = 0; head < tail; head++) {
    const tile = queue[head]!;
    const next = distance[tile]! + 1;
    if (next >= cap) continue;
    const x = tile % width;
    const visit = (n: number): void => {
      if (distance[n]! > next) {
        distance[n] = next;
        queue[tail++] = n;
      }
    };
    if (tile >= width) visit(tile - width);
    if (tile < terrain.length - width) visit(tile + width);
    if (x > 0) visit(tile - 1);
    if (x < width - 1) visit(tile + 1);
  }
  return distance;
}

/** Land relief (water = 0) with a separable box blur. */
function blurredLandRelief(map: GameMap, radius: number): Float32Array {
  const { width, height, terrain, relief } = map;
  const source = new Float32Array(width * height);
  for (let i = 0; i < source.length; i++) source[i] = terrain[i] === Terrain.Water ? 0 : relief[i]!;
  const temp = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += source[y * width + clampIndex(x + k, width)]!;
      temp[y * width + x] = sum / span;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += temp[clampIndex(y + k, height) * width + x]!;
      out[y * width + x] = sum / span;
    }
  }
  return out;
}

/** Light from the north-west: slopes rising toward the south-east face the light. */
function hillshade(
  relief: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const at = (px: number, py: number) =>
    relief[clampIndex(py, height) * width + clampIndex(px, width)]!;
  const dx = at(x + 2, y) - at(x - 2, y);
  const dy = at(x, y + 2) - at(x, y - 2);
  return 1 + Math.max(-SHADE_LIMIT, Math.min(SHADE_LIMIT, (dx + dy) * SHADE_GAIN));
}

function clampIndex(value: number, size: number): number {
  return value < 0 ? 0 : value >= size ? size - 1 : value;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
