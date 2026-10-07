/**
 * Elimination (GAME_DESIGN.md §3.9).
 *
 *  - A player with 0 tiles is eliminated.
 *  - A player under attack who is down to fewer than `absorbBelowTiles` tiles AND at most
 *    `absorbBelowPeakShare` of the most land they ever held is absorbed: their remaining
 *    land goes to their biggest attacker (no tedious mop-up of remnants). The peak rule
 *    keeps a fresh 49-tile start from being swallowed after losing a few tiles.
 *
 * An eliminated player's own armies are lost, and armies attacking them come home.
 */
import { nextScratchStamp, setOwner, type Player, type PlayerId, type World } from "../world.ts";
import { endAttacksInvolving, primaryAttacker } from "./attacks.ts";
import { dropDiplomacy } from "./diplomacy.ts";
import { lootGold } from "./economy.ts";
import { sinkBoatsOf } from "./naval.ts";
import { sinkTradeShipsOf } from "./trade.ts";

/** Tick system. */
export function eliminate(world: World): void {
  const rules = world.rules.elimination;
  for (const player of world.players) {
    if (!player.alive || player.spawnTile < 0) continue;
    if (player.tiles > player.peakTiles) player.peakTiles = player.tiles;

    if (player.tiles === 0) {
      const by = primaryAttacker(world, player.id) ?? player.lastLostTo;
      eliminatePlayer(world, player, by === 0 ? null : by);
      continue;
    }
    const small = player.tiles < rules.absorbBelowTiles;
    const collapsed = player.tiles <= player.peakTiles * rules.absorbBelowPeakShare;
    if (!small || !collapsed) continue;
    const attacker = primaryAttacker(world, player.id);
    if (attacker === null) continue;
    for (const tile of tilesOf(world, player)) setOwner(world, tile, attacker);
    eliminatePlayer(world, player, attacker);
  }
}

function eliminatePlayer(world: World, player: Player, by: PlayerId | null): void {
  player.alive = false;
  player.eliminatedTick = world.tick;
  endAttacksInvolving(world, player.id);
  sinkBoatsOf(world, player.id);
  sinkTradeShipsOf(world, player.id);
  dropDiplomacy(world, player.id);
  player.homeTroops = 0;
  player.fieldTroops = 0;
  player.capacity = 0;
  player.lastGrowth = 0;
  const loot = lootGold(world, player, by);
  world.events.push({ type: "eliminated", playerId: player.id, by, loot });
}

/** All tiles of a (small) player, found by flooding each piece from its border tiles. */
function tilesOf(world: World, player: Player): number[] {
  const { width } = world.map;
  const o = world.owner;
  const marks = world.scratchMarks;
  const stamp = nextScratchStamp(world);
  const tiles: number[] = [];
  const visit = (tile: number): void => {
    if (o[tile] === player.id && marks[tile] !== stamp) {
      marks[tile] = stamp;
      tiles.push(tile);
    }
  };
  for (const start of player.border) visit(start);
  for (let k = 0; k < tiles.length; k++) {
    const tile = tiles[k]!;
    const x = tile % width;
    if (tile >= width) visit(tile - width);
    if (tile + width < o.length) visit(tile + width);
    if (x > 0) visit(tile - 1);
    if (x < width - 1) visit(tile + 1);
  }
  return tiles;
}
