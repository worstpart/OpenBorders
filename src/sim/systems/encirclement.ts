/**
 * Encirclement (GAME_DESIGN.md §3.8): land that is completely enclosed by other players —
 * touching no water, no map edge and no neutral land — falls to the encloser at once.
 * This is what makes border geometry matter: cut an enemy in two and the landlocked
 * part may fall instantly. Coasts are safe.
 *
 *  - A cut-off pocket (any piece but the player's largest) falls when enclosed, by one
 *    player or several.
 *  - The player's main territory only falls when a single player surrounds it AND is
 *    attacking them with an army at least as big as their home troops (a real assault
 *    they'd lose anyway). Otherwise every inland player bordered by two neighbours would
 *    be wiped out at once, and a neighbour could swallow a whole player — troops and all —
 *    by expanding around them, or with a token attack (both found in the milestone 1.5
 *    play-test).
 *  - With several enclosers, the one attacking this player with the biggest army takes
 *    it; otherwise the one sharing the longest border with the piece.
 *
 * Each player is checked every `intervalTicks` (staggered by id), and only if ownership
 * changed next to their land since the last check.
 */
import { isLand } from "../map/gameMap.ts";
import {
  NEUTRAL,
  nextScratchStamp,
  setOwner,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";
import { primaryAttacker, strongestAttack } from "./attacks.ts";

interface Piece {
  /** Any tile of the piece (to flood it again when annexing). */
  start: number;
  size: number;
  /** Touches water, the map edge or neutral land: can't be encircled. */
  safe: boolean;
  /** Shared edge length with each neighbouring player. */
  neighbors: Map<PlayerId, number>;
}

/** Tick system: annexes enclosed land of the players due for a check this tick. */
export function encircle(world: World): void {
  const interval = world.rules.encirclement.intervalTicks;
  for (const player of world.players) {
    if (!player.alive || player.tiles === 0 || !player.encircleDirty) continue;
    if ((world.tick + player.id) % interval !== 0) continue;
    player.encircleDirty = false;
    annexEnclosedPieces(world, player);
  }
}

function annexEnclosedPieces(world: World, player: Player): void {
  // Every piece has at least one border tile, so flooding from border tiles finds all of
  // them. Collect first: annexing changes the border set being iterated.
  const stamp = nextScratchStamp(world);
  const pieces: Piece[] = [];
  for (const tile of player.border) {
    if (world.scratchMarks[tile] !== stamp)
      pieces.push(measurePiece(world, player.id, tile, stamp));
  }
  let main = pieces[0];
  for (const piece of pieces) if (main && piece.size > main.size) main = piece;

  for (const piece of pieces) {
    if (piece.safe || piece.neighbors.size === 0) continue;
    if (piece === main) {
      if (piece.neighbors.size !== 1) continue;
      const assault = strongestAttack(world, player.id, piece.neighbors);
      const needed = world.rules.encirclement.mainTerritoryArmyShare * player.homeTroops;
      if (!assault || assault.troops < needed) continue;
    }
    const capturer = chooseCapturer(world, player.id, piece);
    const tiles = transferPiece(world, player.id, piece.start, capturer);
    world.events.push({ type: "encircled", playerId: player.id, by: capturer, tiles });
  }
}

/** Flood-fills one piece of `owner`'s land, marking its tiles with `stamp`. */
function measurePiece(world: World, owner: PlayerId, start: number, stamp: number): Piece {
  const { width } = world.map;
  const o = world.owner;
  const marks = world.scratchMarks;
  const queue = world.scratchQueue;
  const neighbors = new Map<PlayerId, number>();
  let safe = false;
  let head = 0;
  let tail = 0;

  const look = (tile: number): void => {
    const other = o[tile]!;
    if (other === owner) {
      if (marks[tile] !== stamp) {
        marks[tile] = stamp;
        queue[tail++] = tile;
      }
    } else if (other === NEUTRAL || !isLand(world.map, tile)) {
      safe = true; // neutral land or water
    } else {
      neighbors.set(other, (neighbors.get(other) ?? 0) + 1);
    }
  };

  marks[start] = stamp;
  queue[tail++] = start;
  while (head < tail) {
    const tile = queue[head++]!;
    const x = tile % width;
    if (tile < width || tile + width >= o.length || x === 0 || x === width - 1) safe = true;
    if (tile >= width) look(tile - width);
    if (tile + width < o.length) look(tile + width);
    if (x > 0) look(tile - 1);
    if (x < width - 1) look(tile + 1);
  }
  return { start, size: tail, safe, neighbors };
}

function chooseCapturer(world: World, victim: PlayerId, piece: Piece): PlayerId {
  const attacker = primaryAttacker(world, victim, piece.neighbors);
  if (attacker !== null) return attacker;
  let best: PlayerId = -1;
  let longest = -1;
  for (const [id, edges] of piece.neighbors) {
    if (edges > longest || (edges === longest && id < best)) {
      best = id;
      longest = edges;
    }
  }
  return best;
}

/** Gives every tile of the piece containing `start` to `capturer`. Returns the tile count. */
function transferPiece(world: World, from: PlayerId, start: number, capturer: PlayerId): number {
  const { width } = world.map;
  const o = world.owner;
  const marks = world.scratchMarks;
  const queue = world.scratchQueue;
  const stamp = nextScratchStamp(world);
  let head = 0;
  let tail = 0;
  marks[start] = stamp;
  queue[tail++] = start;
  const enqueue = (tile: number): void => {
    if (o[tile] === from && marks[tile] !== stamp) {
      marks[tile] = stamp;
      queue[tail++] = tile;
    }
  };
  while (head < tail) {
    const tile = queue[head++]!;
    const x = tile % width;
    if (tile >= width) enqueue(tile - width);
    if (tile + width < o.length) enqueue(tile + width);
    if (x > 0) enqueue(tile - 1);
    if (x < width - 1) enqueue(tile + 1);
    setOwner(world, tile, capturer);
  }
  return tail;
}
