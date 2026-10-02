/** Tile searches the HUD needs to aim commands (e.g. a counter-attack). */

/**
 * The tile owned by `ownerId` nearest to `from` (Chebyshev rings, then row order), or
 * -1 if they own nothing. Rings stop at `maxRadius`; beyond that the whole map is scanned.
 */
export function nearestOwnedTile(
  owner: Uint16Array,
  width: number,
  height: number,
  from: number,
  ownerId: number,
  maxRadius = 64,
): number {
  const fx = from % width;
  const fy = (from - fx) / width;
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const y = fy + dy;
      if (y < 0 || y >= height) continue;
      // Only the ring's outline: full rows at the top and bottom, two cells elsewhere.
      const step = dy === -r || dy === r ? 1 : 2 * r || 1;
      for (let dx = -r; dx <= r; dx += step) {
        const x = fx + dx;
        if (x < 0 || x >= width) continue;
        const tile = y * width + x;
        if (owner[tile] === ownerId) return tile;
      }
    }
  }
  for (let tile = 0; tile < owner.length; tile++) if (owner[tile] === ownerId) return tile;
  return -1;
}
