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
    .addInt(world.winningTeam)
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
      .addInt(p.lastLostTo)
      .addInt(p.traitorUntilTick)
      .addInt(p.betrayals)
      .addInt(p.team)
      .addNumber(p.gold)
      .addNumber(p.tradeGold)
      .addInt(p.lastEmoteTick)
      .addInt(p.lastPingTick);
  }
  for (const p of world.players) {
    if (p.brain) {
      h.addString(p.brain.personality).addInt(p.brain.nextThinkTick).addInt(p.brain.idleThinks);
      h.addInt(p.brain.grudges.size);
      for (const [id, until] of p.brain.grudges) h.addInt(id).addInt(until);
    }
  }
  h.addInt(world.alliances.size);
  for (const a of world.alliances.values()) {
    h.addInt(a.a).addInt(a.b).addInt(a.formedTick).addInt(a.expiresTick);
    h.addInt(a.renewA).addInt(a.renewB);
  }
  h.addInt(world.allianceRequests.length);
  for (const r of world.allianceRequests) h.addInt(r.from).addInt(r.to).addInt(r.expiresTick);
  h.addInt(world.lastRequestTick.size);
  for (const [key, tick] of world.lastRequestTick) h.addInt(key).addInt(tick);
  h.addInt(world.lastDonationTick.size);
  for (const [key, tick] of world.lastDonationTick) h.addNumber(key).addInt(tick);
  h.addInt(world.pendingCommands.length);
  for (const c of world.pendingCommands) h.addInt(c.playerId).addString(JSON.stringify(c.command));
  h.addInt(world.nextAttackId).addInt(world.attacks.length);
  for (const a of world.attacks) {
    h.addInt(a.id)
      .addInt(a.attacker)
      .addInt(a.target)
      .addNumber(a.troops)
      .addInt(a.focusTile)
      .addInt(a.growthSeed)
      .addInt(a.tilesTaken)
      .addInt(a.retreatTick)
      .addInt(a.freeRetreat)
      .addInt(a.landingTile)
      .addNumber(a.lossFactor)
      .addInt(a.front.size)
      .addNumber(a.front.peekTime());
    // Airborne (2B.3) only when true, so games without assaults keep their hashes.
    if (a.airborne) h.addInt(1);
  }
  h.addInt(world.nextBoatId).addInt(world.boats.length);
  for (const b of world.boats) {
    h.addInt(b.id)
      .addInt(b.owner)
      .addInt(b.target)
      .addNumber(b.troops)
      .addInt(b.launchTile)
      .addInt(b.landingTile)
      .addInt(b.focusTile)
      .addInt(b.route.length)
      .addInt(b.launchTick)
      .addNumber(b.tilesPerTick)
      .addNumber(b.lossFactor)
      .addInt(b.arriveTick)
      .addInt(b.recallTick);
  }
  h.addInt(world.nextTradeShipId).addInt(world.tradeShips.length);
  for (const s of world.tradeShips) {
    h.addInt(s.id)
      .addInt(s.owner)
      .addInt(s.fromPort)
      .addInt(s.toPort)
      .addInt(s.launchTile)
      .addInt(s.landingTile)
      .addInt(s.route.length)
      .addInt(s.launchTick)
      .addNumber(s.tilesPerTick)
      .addInt(s.arriveTick)
      .addInt(s.gold);
  }
  // Flights (2B.0), hashed once the game has had one (so games without flights keep the
  // hashes they had before 2B.0 — the regression check compares them).
  if (world.nextFlightId > 1) {
    h.addInt(world.nextFlightId).addInt(world.flights.length);
    for (const f of world.flights) {
      h.addInt(f.id)
        .addInt(f.owner)
        .addString(f.kind)
        .addInt(f.source)
        .addInt(f.fromTile)
        .addInt(f.toTile)
        .addInt(f.target)
        .addInt(f.planes)
        .addNumber(f.troops)
        .addInt(f.launchTick)
        .addInt(f.arriveTick);
    }
  }
  h.addInt(world.nextPingId).addInt(world.pings.length);
  for (const p of world.pings) {
    h.addInt(p.id)
      .addInt(p.from)
      .addInt(p.tile)
      .addString(p.kind)
      .addInt(p.target)
      .addInt(p.tick)
      .addInt(p.expiresTick);
  }
  h.addInt(world.nextBuildingId).addInt(world.buildings.length);
  for (const b of world.buildings) {
    h.addInt(b.id)
      .addString(b.type)
      .addInt(b.owner)
      .addInt(b.tile)
      .addInt(b.level)
      .addInt(b.targetLevel)
      .addInt(b.startTick)
      .addInt(b.readyTick)
      .addInt(b.paid);
    // Phase 2B charges and cooldowns, hashed once a building has used any (so games without
    // them keep the hashes they had before 2B.0).
    if (b.reloads.length > 0 || b.cooldowns.length > 0) {
      h.addInt(0x2b0).addInt(b.reloads.length).addInt(b.cooldowns.length);
      for (const t of b.reloads) h.addInt(t);
      for (const t of b.cooldowns) h.addInt(t);
    }
  }
  h.addInt(world.nextWallId).addInt(world.walls.length).addInt(world.wallHash);
  for (const w of world.walls) {
    h.addInt(w.id)
      .addInt(w.owner)
      .addInt(w.intact)
      .addInt(w.level)
      .addInt(w.targetLevel)
      .addInt(w.startTick)
      .addInt(w.readyTick)
      .addInt(w.paid);
  }
  for (const word of world.rng.getState()) h.addInt(word);
  return h.digest();
}
