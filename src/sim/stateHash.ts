/**
 * State hashes: two worlds with equal hashes are (with overwhelming probability) in
 * identical states. Used by determinism tests now and desync detection in Phase 3.
 *
 * Tile ownership (hundreds of thousands of tiles) is hashed incrementally: every
 * (tile, owner) pair has a pseudo-random 32-bit value and the ownership hash is the XOR
 * of those values, so a change costs O(1) instead of rehashing the whole map.
 */
import { Hasher, mix32 } from "./math/hash.ts";
import type { World } from "./world.ts";

/** Hash contribution of one tile owned by `owner`. Neutral tiles contribute 0. */
export function ownerTileHash(tile: number, owner: number): number {
  if (owner === 0) return 0;
  return mix32(Math.imul(tile + 1, 0x9e3779b1) ^ mix32(owner * 0x632be5ab));
}

/** Recomputes the ownership hash from scratch (tests use it to check the incremental one). */
export function computeOwnerHash(owner: Uint16Array): number {
  let hash = 0;
  for (let tile = 0; tile < owner.length; tile++) {
    if (owner[tile] !== 0) hash ^= ownerTileHash(tile, owner[tile]!);
  }
  return hash >>> 0;
}

/** Hash of the whole game state. Cheap enough to compute every tick. */
export function hashWorld(world: World): number {
  const h = new Hasher()
    .addInt(world.tick)
    .addString(world.phase)
    .addInt(world.playStartTick)
    .addInt(world.winner ?? 0)
    .addInt(world.ownerHash);
  for (const p of world.players) {
    h.addInt(p.id)
      .addInt(p.alive)
      .addInt(p.spawnTile)
      .addInt(p.ready)
      .addNumber(p.homeTroops)
      .addNumber(p.fieldTroops)
      .addInt(p.tiles)
      .addNumber(p.capacity)
      .addInt(p.peakTiles)
      .addInt(p.eliminatedTick)
      .addInt(p.lastLostTo);
  }
  for (const p of world.players) {
    if (p.brain) {
      h.addString(p.brain.personality).addInt(p.brain.nextThinkTick).addInt(p.brain.idleThinks);
    }
  }
  h.addInt(world.pendingCommands.length);
  for (const c of world.pendingCommands) h.addInt(c.playerId).addString(JSON.stringify(c.command));
  h.addInt(world.nextAttackId).addInt(world.attacks.length);
  for (const a of world.attacks) {
    h.addInt(a.id)
      .addInt(a.attacker)
      .addInt(a.target)
      .addNumber(a.troops)
      .addInt(a.focusTile)
      .addInt(a.tilesTaken)
      .addInt(a.retreatTick)
      .addInt(a.front.size)
      .addNumber(a.front.peekTime());
  }
  for (const word of world.rng.getState()) h.addInt(word);
  return h.digest();
}
