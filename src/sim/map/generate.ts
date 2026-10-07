/**
 * Procedural continent generator (D-009). The same seed produces the same map on every
 * machine, so multiplayer games only need to share the seed.
 *
 *  1. Elevation = domain-warped fractal noise minus a radial falloff (ocean at the edges).
 *  2. Sea level is chosen so that exactly `landShare` of the map is above it.
 *  3. Only the largest landmass is kept and tiny lakes are filled (they'd be visual
 *     noise). Islands (milestone 2.7, D-025) are a separate layer: 5–7 island centres
 *     with their own falloff, raised to ~8% of the map, only beyond a strait of open sea
 *     around the continent; islets are sunk. `islands: false` makes the old map exactly.
 *  4. Land is split into plains / highland / mountain by a mix of height and ridged
 *     noise, so mountains form chains rather than blobs.
 */
import { Rng } from "../math/rng.ts";
import { createMap, Terrain, type GameMap } from "./gameMap.ts";
import { fractalNoise, ridgedNoise } from "./noise.ts";

export interface ContinentOptions {
  readonly seed: number;
  readonly width?: number;
  readonly height?: number;
  /** Share of the map that is land before islands are removed. */
  readonly landShare?: number;
  /** Shares of the land that become mountain and highland; the rest is plains. */
  readonly mountainShare?: number;
  readonly highlandShare?: number;
  /** Lakes smaller than this many tiles are filled in. */
  readonly minLakeTiles?: number;
  /**
   * Islands around the continent (D-025, milestone 2.7: boats need somewhere to go).
   * Default true; false gives the single-continent maps of milestones 1.1–2.6.
   */
  readonly islands?: boolean;
  /** Landmasses smaller than this many tiles are sunk (islets would be visual noise). */
  readonly minIslandTiles?: number;
}

/** The Phase 1 reference map size (GAME_DESIGN.md §3.2). */
export const REFERENCE_MAP_WIDTH = 1100;
export const REFERENCE_MAP_HEIGHT = 700;

// Shape constants: chosen by eye for a single, ragged, mid-sized continent.
const FEATURE_SCALE = 1 / 260; // base noise wavelength ≈ 260 tiles
const RIDGE_SCALE = 1 / 150; // mountain chains are narrower than continents
const WARP_STRENGTH = 0.8; // how far coastlines are pushed around (in noise units)
const NOISE_AMPLITUDE = 1.6; // relief vs. falloff: higher = more bays, peninsulas and lakes
const FALLOFF = 0.9; // how strongly elevation drops toward the map edge
const HEIGHT_WEIGHT = 0.3; // mountains follow ridge chains (0.7) more than raw height (0.3)
const EDGE_FADE_TILES = 45; // elevation is pushed down within this distance of the edge…
const EDGE_FADE_DEPTH = 2.5; // …by up to this much, so coasts never get clipped flat
const EDGE_MARGIN = 2; // tiles along the edge that are always water
// Islands (D-025): the continent shrinks a little to make room for 5–7 islands in the
// ring around it. They hold this share of the map (of landShare), at least this many
// tiles of sea away from the continent's coast.
const CONTINENT_SCALE_WITH_ISLANDS = 0.85;
const ISLAND_SHARE = 0.08;
const ISLAND_STRAIT_TILES = 18;

export function generateContinent(options: ContinentOptions): GameMap {
  const width = options.width ?? REFERENCE_MAP_WIDTH;
  const height = options.height ?? REFERENCE_MAP_HEIGHT;
  const landShare = options.landShare ?? (options.islands === false ? 0.55 : 0.5);
  const mountainShare = options.mountainShare ?? 0.1;
  const highlandShare = options.highlandShare ?? 0.22;
  const minLakeTiles = options.minLakeTiles ?? 80;
  const minIslandTiles = options.minIslandTiles ?? 400;
  const tileCount = width * height;

  const rng = new Rng(options.seed);
  const shapeSeed = rng.nextUint32();
  const warpSeedX = rng.nextUint32();
  const warpSeedY = rng.nextUint32();
  const ridgeSeed = rng.nextUint32();
  const islands = options.islands === false ? [] : placeIslands(rng, width, height);

  // 1. Elevation: the continent's, and (D-025) the islands' — each island centre has its
  //    own small falloff, so islands get coastlines of their own.
  const elevation = new Float64Array(tileCount);
  const islandElevation = islands.length > 0 ? new Float64Array(tileCount) : null;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const continentScale = islands.length > 0 ? CONTINENT_SCALE_WITH_ISLANDS : 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x * FEATURE_SCALE;
      const sy = y * FEATURE_SCALE;
      const wx = sx + WARP_STRENGTH * fractalNoise(warpSeedX, sx, sy, 3);
      const wy = sy + WARP_STRENGTH * fractalNoise(warpSeedY, sx, sy, 3);
      // The falloff also uses warped coordinates, so the outline isn't a plain ellipse.
      const dx = (wx / FEATURE_SCALE - centerX) / (width * 0.5 * continentScale);
      const dy = (wy / FEATURE_SCALE - centerY) / (height * 0.5 * continentScale);
      const edgeDistance = Math.min(x, y, width - 1 - x, height - 1 - y);
      const edgeFade = Math.max(0, 1 - edgeDistance / EDGE_FADE_TILES);
      const relief =
        NOISE_AMPLITUDE * fractalNoise(shapeSeed, wx, wy, 6) -
        EDGE_FADE_DEPTH * edgeFade * edgeFade;
      elevation[y * width + x] = relief - FALLOFF * (dx * dx + dy * dy);
      if (islandElevation) {
        let falloff = Infinity;
        for (const island of islands) {
          const ix = (wx / FEATURE_SCALE - island.x) / (height * 0.5 * island.radius);
          const iy = (wy / FEATURE_SCALE - island.y) / (height * 0.5 * island.radius);
          falloff = Math.min(falloff, ix * ix + iy * iy);
        }
        islandElevation[y * width + x] = relief - FALLOFF * falloff;
      }
    }
  }

  // 2. Sea level at the (1 − landShare) quantile (with islands: the continent's share).
  const continentShare = islandElevation ? landShare - ISLAND_SHARE : landShare;
  const seaLevel = valueAt(sortedCopy(elevation), 1 - continentShare);
  const land = new Uint8Array(tileCount);
  for (let y = EDGE_MARGIN; y < height - EDGE_MARGIN; y++) {
    for (let x = EDGE_MARGIN; x < width - EDGE_MARGIN; x++) {
      const i = y * width + x;
      if (elevation[i]! > seaLevel) land[i] = 1;
    }
  }

  // 3. Keep the largest landmass; fill small lakes. Islands rise only beyond a strait of
  //    open sea around the continent, and islets are sunk.
  keepLargestComponent(land, width, height, 1);
  if (islandElevation) {
    const nearCoast = withinTiles(land, width, height, ISLAND_STRAIT_TILES);
    const candidates: number[] = [];
    for (let y = EDGE_MARGIN; y < height - EDGE_MARGIN; y++) {
      for (let x = EDGE_MARGIN; x < width - EDGE_MARGIN; x++) {
        const i = y * width + x;
        if (!nearCoast[i]) candidates.push(i);
      }
    }
    const heights = sortedCopy(Float64Array.from(candidates, (i) => islandElevation[i]!));
    const islandSea = valueAt(heights, 1 - (ISLAND_SHARE * tileCount) / candidates.length);
    for (const i of candidates) {
      if (islandElevation[i]! > islandSea) {
        land[i] = 1;
        // One elevation field from here on: island heights measured from their own sea.
        elevation[i] = seaLevel + (islandElevation[i]! - islandSea);
      }
    }
    sinkSmallComponents(land, width, height, minIslandTiles);
  }
  fillSmallLakes(land, width, height, minLakeTiles);

  // 4. Classify land by a mix of height above the sea and ridged noise.
  return classifyTerrain(
    width,
    height,
    land,
    elevation,
    seaLevel,
    ridgeSeed,
    mountainShare,
    highlandShare,
  );
}

/**
 * Map types on the start screen (milestone 2.8, GAME_DESIGN §3.2): the continent of
 * milestones 1.1–2.7, an archipelago of many islands, or two continents across a strait.
 */
export const MAP_STYLES = ["continent", "archipelago", "twin"] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

/**
 * Map sizes on the start screen. Large has ~2× the reference map's tiles, Huge ~4× (for
 * lobbies of 100+ players, milestone 2.8).
 */
export const MAP_SIZE_NAMES = ["normal", "large", "huge"] as const;
export type MapSize = (typeof MAP_SIZE_NAMES)[number];
export const MAP_DIMENSIONS: Readonly<Record<MapSize, { width: number; height: number }>> = {
  normal: { width: REFERENCE_MAP_WIDTH, height: REFERENCE_MAP_HEIGHT },
  large: { width: 1560, height: 990 },
  huge: { width: 2200, height: 1400 },
};

export interface MapSpec {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly style: MapStyle;
}

/** The map for a start-screen choice (the same spec makes the same map everywhere). */
export function generateMap(spec: MapSpec): GameMap {
  if (spec.style === "continent") {
    return generateContinent({ seed: spec.seed, width: spec.width, height: spec.height });
  }
  return generateLandmasses(spec);
}

// Archipelago: the map is cut into cells about a third of its height wide; most cells hold
// an island centre (jittered), a few stay open sea.
const ARCHIPELAGO_LAND_SHARE = 0.38;
const ARCHIPELAGO_OPEN_SEA = 0.25;
// Straits wander: the "which centre" boundary is pushed around by noise of this many tiles.
const SEAM_WIGGLE_TILES = 45;
const SEAM_SCALE = 1 / 70;
const ARCHIPELAGO_STRAIT_TILES = 14;
// Two continents: their land share, and the strait kept open between landmasses.
const TWIN_LAND_SHARE = 0.48;
const TWIN_STRAIT_TILES = 22;

/** An elliptical landmass centre: position and radii in tiles. */
interface Centre {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

/**
 * Archipelagos and twin continents: the continent's noise and warp, but the falloff is
 * measured to the nearest of several centres, so land gathers into separate masses.
 */
function generateLandmasses(spec: MapSpec): GameMap {
  const { width, height, style } = spec;
  const tileCount = width * height;
  const rng = new Rng(spec.seed);
  const shapeSeed = rng.nextUint32();
  const warpSeedX = rng.nextUint32();
  const warpSeedY = rng.nextUint32();
  const ridgeSeed = rng.nextUint32();
  const seamSeedX = rng.nextUint32();
  const seamSeedY = rng.nextUint32();
  const centres =
    style === "twin" ? twinCentres(rng, width, height) : archipelago(rng, width, height);
  const landShare = style === "twin" ? TWIN_LAND_SHARE : ARCHIPELAGO_LAND_SHARE;

  const elevation = new Float64Array(tileCount);
  // Which centre each tile belongs to (its nearest): where two meet, a strait is cut.
  const nearest = new Uint16Array(tileCount);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x * FEATURE_SCALE;
      const sy = y * FEATURE_SCALE;
      const wx = sx + WARP_STRENGTH * fractalNoise(warpSeedX, sx, sy, 3);
      const wy = sy + WARP_STRENGTH * fractalNoise(warpSeedY, sx, sy, 3);
      const qx = x + SEAM_WIGGLE_TILES * fractalNoise(seamSeedX, x * SEAM_SCALE, y * SEAM_SCALE, 2);
      const qy = y + SEAM_WIGGLE_TILES * fractalNoise(seamSeedY, x * SEAM_SCALE, y * SEAM_SCALE, 2);
      let falloff = Infinity;
      let closest = Infinity;
      for (let k = 0; k < centres.length; k++) {
        const c = centres[k]!;
        const dx = (wx / FEATURE_SCALE - c.x) / c.rx;
        const dy = (wy / FEATURE_SCALE - c.y) / c.ry;
        falloff = Math.min(falloff, dx * dx + dy * dy);
        const ex = (qx - c.x) / c.rx;
        const ey = (qy - c.y) / c.ry;
        if (ex * ex + ey * ey < closest) {
          closest = ex * ex + ey * ey;
          nearest[y * width + x] = k;
        }
      }
      const edgeDistance = Math.min(x, y, width - 1 - x, height - 1 - y);
      const edgeFade = Math.max(0, 1 - edgeDistance / EDGE_FADE_TILES);
      const relief =
        NOISE_AMPLITUDE * fractalNoise(shapeSeed, wx, wy, 6) -
        EDGE_FADE_DEPTH * edgeFade * edgeFade;
      elevation[y * width + x] = relief - FALLOFF * falloff;
    }
  }

  const seaLevel = valueAt(sortedCopy(elevation), 1 - landShare);
  const land = new Uint8Array(tileCount);
  for (let y = EDGE_MARGIN; y < height - EDGE_MARGIN; y++) {
    for (let x = EDGE_MARGIN; x < width - EDGE_MARGIN; x++) {
      const i = y * width + x;
      if (elevation[i]! > seaLevel) land[i] = 1;
    }
  }
  // Straits: where land of two centres meets, the sea cuts through, so every landmass stays
  // its own (boats cross; trade ships sail between them).
  const seam = new Uint8Array(tileCount);
  for (let i = 0; i < tileCount; i++) {
    if (!land[i]) continue;
    const x = i % width;
    if (
      (x < width - 1 && land[i + 1] && nearest[i + 1] !== nearest[i]) ||
      (i + width < tileCount && land[i + width] && nearest[i + width] !== nearest[i])
    ) {
      seam[i] = 1;
    }
  }
  const strait = style === "twin" ? TWIN_STRAIT_TILES : ARCHIPELAGO_STRAIT_TILES;
  const cut = withinTiles(seam, width, height, Math.floor(strait / 2));
  for (let i = 0; i < tileCount; i++) if (cut[i]) land[i] = 0;
  sinkSmallComponents(land, width, height, 400);
  fillSmallLakes(land, width, height, 80);
  return classifyTerrain(width, height, land, elevation, seaLevel, ridgeSeed, 0.1, 0.22);
}

/** Island centres for an archipelago: one per grid cell (jittered), some cells left as sea. */
function archipelago(rng: Rng, width: number, height: number): Centre[] {
  const cell = height / 3;
  const cols = Math.max(2, Math.round(width / cell));
  const rows = 3;
  const cw = width / cols;
  const centres: Centre[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (rng.nextFloat() < ARCHIPELAGO_OPEN_SEA) continue;
      const r = cell * (0.28 + 0.14 * rng.nextFloat());
      centres.push({
        x: (col + 0.5 + 0.4 * (rng.nextFloat() - 0.5)) * cw,
        y: (row + 0.5 + 0.4 * (rng.nextFloat() - 0.5)) * cell,
        rx: r * (0.8 + 0.4 * rng.nextFloat()),
        ry: r * (0.8 + 0.4 * rng.nextFloat()),
      });
    }
  }
  return centres;
}

/** Two big continents left and right, and 3–5 islands where there's room. */
function twinCentres(rng: Rng, width: number, height: number): Centre[] {
  const centres: Centre[] = [
    {
      x: width * (0.23 + 0.03 * rng.nextFloat()),
      y: height * (0.45 + 0.1 * rng.nextFloat()),
      rx: width * 0.19,
      ry: height * 0.4,
    },
    {
      x: width * (0.74 + 0.03 * rng.nextFloat()),
      y: height * (0.45 + 0.1 * rng.nextFloat()),
      rx: width * 0.19,
      ry: height * 0.4,
    },
  ];
  const wanted = 3 + rng.nextInt(3);
  for (let attempt = 0; attempt < 100 && centres.length < 2 + wanted; attempt++) {
    const x = width * (0.08 + 0.84 * rng.nextFloat());
    const y = height * (0.08 + 0.84 * rng.nextFloat());
    const r = height * (0.06 + 0.05 * rng.nextFloat());
    // Islands sit in open water: outside both continents' ellipses (with a margin).
    const clear = centres.every((c) => {
      const dx = (x - c.x) / (c.rx + r * 2.5);
      const dy = (y - c.y) / (c.ry + r * 2.5);
      return dx * dx + dy * dy > 1;
    });
    if (clear) centres.push({ x, y, rx: r, ry: r });
  }
  return centres;
}

/**
 * Step 4 of every generator: land becomes plains / highland / mountain by a mix of height
 * above the sea and ridged noise (mountains form chains); relief for shading.
 */
function classifyTerrain(
  width: number,
  height: number,
  land: Uint8Array,
  elevation: Float64Array,
  seaLevel: number,
  ridgeSeed: number,
  mountainShare: number,
  highlandShare: number,
): GameMap {
  const tileCount = width * height;
  let maxElevation = seaLevel;
  let minElevation = seaLevel;
  for (let i = 0; i < tileCount; i++) {
    if (elevation[i]! > maxElevation) maxElevation = elevation[i]!;
    if (elevation[i]! < minElevation) minElevation = elevation[i]!;
  }
  const landIndices: number[] = [];
  const score = new Float64Array(tileCount);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!land[i]) continue;
      const heightAboveSea = Math.max(0, elevation[i]! - seaLevel) / (maxElevation - seaLevel);
      const ridge = ridgedNoise(ridgeSeed, x * RIDGE_SCALE, y * RIDGE_SCALE, 4);
      score[i] = HEIGHT_WEIGHT * heightAboveSea + (1 - HEIGHT_WEIGHT) * ridge;
      landIndices.push(i);
    }
  }
  const landScores = sortedCopy(Float64Array.from(landIndices, (i) => score[i]!));
  const mountainLevel = valueAt(landScores, 1 - mountainShare);
  const highlandLevel = valueAt(landScores, 1 - mountainShare - highlandShare);
  const lowestScore = valueAt(landScores, 0);
  const highestScore = valueAt(landScores, 1);

  const terrain = new Uint8Array(tileCount);
  const relief = new Uint8Array(tileCount);
  for (let i = 0; i < tileCount; i++) {
    if (land[i]) {
      const s = score[i]!;
      terrain[i] =
        s >= mountainLevel
          ? Terrain.Mountain
          : s >= highlandLevel
            ? Terrain.Highland
            : Terrain.Plains;
      relief[i] = toByte((s - lowestScore) / (highestScore - lowestScore));
    } else {
      terrain[i] = Terrain.Water;
      relief[i] = toByte((seaLevel - elevation[i]!) / (seaLevel - minElevation));
    }
  }
  return createMap(width, height, terrain, relief);
}

interface IslandCentre {
  readonly x: number;
  readonly y: number;
  /** Radius in half-heights of the map. */
  readonly radius: number;
}

/** 5–7 island centres in the ring between the continent and the map edge, apart from each other. */
function placeIslands(rng: Rng, width: number, height: number): IslandCentre[] {
  const wanted = 5 + rng.nextInt(3);
  const islands: IslandCentre[] = [];
  for (let attempt = 0; attempt < 200 && islands.length < wanted; attempt++) {
    // A random point of the ring (no trigonometry: it isn't exact across engines).
    const u = 2 * rng.nextFloat() - 1;
    const v = 2 * rng.nextFloat() - 1;
    const ring = Math.sqrt(u * u + v * v);
    const radius = 0.12 + 0.1 * rng.nextFloat();
    if (ring < 0.74 || ring > 0.9) continue;
    const x = (width - 1) / 2 + u * width * 0.5;
    const y = (height - 1) / 2 + v * height * 0.5;
    const apart = islands.every((o) => {
      const dx = (x - o.x) / (height * 0.5);
      const dy = (y - o.y) / (height * 0.5);
      const gap = 1.3 * (radius + o.radius);
      return dx * dx + dy * dy > gap * gap;
    });
    if (apart) islands.push({ x, y, radius });
  }
  return islands;
}

function sortedCopy(values: Float64Array): Float64Array {
  return Float64Array.from(values).sort();
}

/** Value at fraction `q` (0..1) of already sorted values. */
function valueAt(sorted: Float64Array, q: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[index]!;
}

function toByte(fraction: number): number {
  return Math.max(0, Math.min(255, Math.round(fraction * 255)));
}

/**
 * Labels 4-connected components of cells equal to `value`; returns the label array
 * (0 = not part of any component) and each component's size (index = label − 1).
 */
function labelComponents(
  cells: Uint8Array,
  width: number,
  height: number,
  value: number,
): { labels: Int32Array; sizes: number[]; touchesEdge: boolean[] } {
  const labels = new Int32Array(cells.length);
  const sizes: number[] = [];
  const touchesEdge: boolean[] = [];
  const queue = new Int32Array(cells.length);
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] !== value || labels[start] !== 0) continue;
    const label = sizes.length + 1;
    let head = 0;
    let tail = 0;
    let edge = false;
    queue[tail++] = start;
    labels[start] = label;
    while (head < tail) {
      const tile = queue[head++]!;
      const x = tile % width;
      const y = (tile - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      for (let k = 0; k < 4; k++) {
        if ((k === 0 && y === 0) || (k === 1 && x === width - 1)) continue;
        if ((k === 2 && y === height - 1) || (k === 3 && x === 0)) continue;
        const next = tile + (k === 0 ? -width : k === 1 ? 1 : k === 2 ? width : -1);
        if (cells[next] === value && labels[next] === 0) {
          labels[next] = label;
          queue[tail++] = next;
        }
      }
    }
    sizes.push(tail);
    touchesEdge.push(edge);
  }
  return { labels, sizes, touchesEdge };
}

function keepLargestComponent(
  cells: Uint8Array,
  width: number,
  height: number,
  value: number,
): void {
  const { labels, sizes } = labelComponents(cells, width, height, value);
  if (sizes.length <= 1) return;
  let largest = 0;
  for (let k = 1; k < sizes.length; k++) if (sizes[k]! > sizes[largest]!) largest = k;
  for (let i = 0; i < cells.length; i++) {
    if (labels[i] !== 0 && labels[i] !== largest + 1) cells[i] = 0;
  }
}

/** Sinks every landmass smaller than `minTiles`. */
function sinkSmallComponents(
  cells: Uint8Array,
  width: number,
  height: number,
  minTiles: number,
): void {
  const { labels, sizes } = labelComponents(cells, width, height, 1);
  for (let i = 0; i < cells.length; i++) {
    if (labels[i] !== 0 && sizes[labels[i]! - 1]! < minTiles) cells[i] = 0;
  }
}

/** Marks every tile within `distance` steps (4-connected) of a set cell. */
function withinTiles(
  cells: Uint8Array,
  width: number,
  height: number,
  distance: number,
): Uint8Array {
  const dist = new Int32Array(cells.length).fill(-1);
  const queue = new Int32Array(cells.length);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const tile = queue[head++]!;
    if (dist[tile]! >= distance) continue;
    const x = tile % width;
    const y = (tile - x) / width;
    const next = [
      y > 0 ? tile - width : -1,
      x < width - 1 ? tile + 1 : -1,
      y < height - 1 ? tile + width : -1,
      x > 0 ? tile - 1 : -1,
    ];
    for (const n of next) {
      if (n >= 0 && dist[n] === -1) {
        dist[n] = dist[tile]! + 1;
        queue[tail++] = n;
      }
    }
  }
  const out = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) if (dist[i]! >= 0) out[i] = 1;
  return out;
}

/** Turns enclosed water bodies (lakes, not the ocean) smaller than `minTiles` into land. */
function fillSmallLakes(land: Uint8Array, width: number, height: number, minTiles: number): void {
  const { labels, sizes, touchesEdge } = labelComponents(land, width, height, 0);
  for (let i = 0; i < land.length; i++) {
    const label = labels[i]!;
    if (label !== 0 && !touchesEdge[label - 1] && sizes[label - 1]! < minTiles) land[i] = 1;
  }
}
