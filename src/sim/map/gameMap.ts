/**
 * The static map: size, terrain and relief. Tiles are integer indices `y * width + x`,
 * 4-connected (N/E/S/W). Ownership is dynamic and lives in the World, not here.
 */

export const Terrain = {
  Water: 0,
  Plains: 1,
  Highland: 2,
  Mountain: 3,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export interface GameMap {
  readonly width: number;
  readonly height: number;
  /** Terrain per tile. */
  readonly terrain: Uint8Array;
  /**
   * Relief per tile for shading only (the simulation ignores it): height above the
   * coast on land, depth below it on water, each scaled to 0–255.
   */
  readonly relief: Uint8Array;
  /** Number of non-water tiles. */
  readonly landTiles: number;
}

export function createMap(
  width: number,
  height: number,
  terrain: Uint8Array,
  relief?: Uint8Array,
): GameMap {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid map size ${width}×${height}`);
  }
  if (terrain.length !== width * height) throw new RangeError("terrain size does not match map");
  if (width * height > 0x1000000) throw new RangeError("maps are limited to 16M tiles");
  let landTiles = 0;
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i]! > Terrain.Mountain) {
      throw new RangeError(`invalid terrain ${terrain[i]} at ${i}`);
    }
    if (terrain[i] !== Terrain.Water) landTiles++;
  }
  return { width, height, terrain, relief: relief ?? new Uint8Array(width * height), landTiles };
}

export function isLand(map: GameMap, tile: number): boolean {
  return map.terrain[tile] !== Terrain.Water;
}

export function tileX(map: GameMap, tile: number): number {
  return tile % map.width;
}

export function tileY(map: GameMap, tile: number): number {
  return Math.floor(tile / map.width);
}

export function tileAt(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function isValidTile(map: GameMap, tile: number): boolean {
  return Number.isInteger(tile) && tile >= 0 && tile < map.terrain.length;
}

/** Squared distance between two tiles (integer, exact). */
export function distanceSquared(map: GameMap, a: number, b: number): number {
  const dx = tileX(map, a) - tileX(map, b);
  const dy = tileY(map, a) - tileY(map, b);
  return dx * dx + dy * dy;
}

/**
 * Writes the 4-connected neighbors of `tile` into `out` and returns how many there are
 * (2–4). Allocation-free for hot loops: callers reuse one `out` array.
 */
export function neighbors(map: GameMap, tile: number, out: Int32Array): number {
  const { width } = map;
  const x = tile % width;
  let count = 0;
  if (tile >= width) out[count++] = tile - width;
  if (x < width - 1) out[count++] = tile + 1;
  if (tile + width < map.terrain.length) out[count++] = tile + width;
  if (x > 0) out[count++] = tile - 1;
  return count;
}

/** True if the tile is on the outer edge of the map. */
export function isMapEdge(map: GameMap, tile: number): boolean {
  const x = tileX(map, tile);
  const y = tileY(map, tile);
  return x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
}
