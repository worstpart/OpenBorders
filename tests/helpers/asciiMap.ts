/**
 * Tiny maps written as ASCII art, so scenario tests are readable by anyone:
 *
 *   ~  water        .  plains        ^  highland        M  mountain
 *   1–9  plains owned by that player
 *
 * Example:
 *   const world = worldFromAscii(`
 *     ~~~~~~
 *     ~11..~
 *     ~1.22~
 *     ~~~~~~
 *   `);
 */
import { createMap, Terrain } from "../../src/sim/map/gameMap.ts";
import type { GameRules } from "../../src/sim/rules.ts";
import { startingTroops, troopCapacity } from "../../src/sim/systems/troops.ts";
import {
  createWorld,
  NEUTRAL,
  setOwner,
  type PlayerKind,
  type World,
} from "../../src/sim/world.ts";

const TERRAIN_CHARS: Record<string, Terrain> = {
  "~": Terrain.Water,
  ".": Terrain.Plains,
  "^": Terrain.Highland,
  M: Terrain.Mountain,
};
const CHAR_FOR_TERRAIN = ["~", ".", "^", "M"];

/** Removes blank first/last lines and the common indentation of a template literal. */
export function dedent(text: string): string[] {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
  const indent = Math.min(...lines.map((line) => line.match(/^ */)![0].length));
  return lines.map((line) => line.slice(indent).trimEnd());
}

export interface ParsedAscii {
  width: number;
  height: number;
  terrain: Uint8Array;
  owners: Uint16Array;
}

export function parseAscii(ascii: string): ParsedAscii {
  const rows = dedent(ascii);
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const terrain = new Uint8Array(width * height);
  const owners = new Uint16Array(width * height);
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`ASCII map row ${y} has ${row.length} chars, expected ${width}`);
    }
    [...row].forEach((char, x) => {
      const tile = y * width + x;
      if (char >= "1" && char <= "9") {
        terrain[tile] = Terrain.Plains;
        owners[tile] = Number(char);
      } else if (char in TERRAIN_CHARS) {
        terrain[tile] = TERRAIN_CHARS[char]!;
      } else {
        throw new Error(`Unknown ASCII map character "${char}" at ${x},${y}`);
      }
    });
  });
  return { width, height, terrain, owners };
}

export interface AsciiWorldOptions {
  /** Player kinds; defaults to bots, as many as the highest digit on the map. */
  players?: PlayerKind[];
  /** Home troops per player (index 0 = player 1); defaults to each player's starting troops. */
  homeTroops?: number[];
  rules?: GameRules;
  seed?: number;
  /**
   * "playing" (default): the match is already running and spawn protection is over;
   * "spawn": a fresh world in the spawn phase (digits on the map are not allowed).
   */
  phase?: "playing" | "spawn";
}

export function worldFromAscii(ascii: string, options: AsciiWorldOptions = {}): World {
  const parsed = parseAscii(ascii);
  const highestOwner = parsed.owners.reduce((max, owner) => Math.max(max, owner), 0);
  const kinds =
    options.players ?? Array.from({ length: Math.max(1, highestOwner) }, () => "bot" as const);
  if (kinds.length < highestOwner) throw new Error("ASCII map uses more players than were given");

  const world = createWorld({
    seed: options.seed ?? 1,
    map: createMap(parsed.width, parsed.height, parsed.terrain),
    players: kinds.map((kind, k) => ({ name: `P${k + 1}`, kind })),
    rules: options.rules,
  });
  const phase = options.phase ?? "playing";
  if (phase === "spawn") {
    if (highestOwner > 0) throw new Error("spawn-phase ASCII worlds can't have owned tiles");
    return world;
  }

  for (let tile = 0; tile < parsed.owners.length; tile++) {
    if (parsed.owners[tile] !== NEUTRAL) setOwner(world, tile, parsed.owners[tile]!);
  }
  for (const player of world.players) {
    player.spawnTile = parsed.owners.indexOf(player.id);
    player.ready = true;
    player.capacity = troopCapacity(world.rules, player.tiles);
    player.homeTroops =
      options.homeTroops?.[player.id - 1] ?? startingTroops(world.rules, player.tiles);
    if (player.tiles === 0) player.alive = false;
  }
  world.phase = "playing";
  // Pretend the match started long enough ago that spawn protection is over.
  world.playStartTick = world.tick - world.rules.spawn.protectionTicks;
  world.changes.clear();
  return world;
}

/** Renders ownership as ASCII (digits for owned tiles, terrain characters otherwise). */
export function ownersToAscii(world: World): string {
  const { width, height, terrain } = world.map;
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const tile = y * width + x;
      const owner = world.owner[tile]!;
      row += owner !== NEUTRAL ? String(owner) : CHAR_FOR_TERRAIN[terrain[tile]!];
    }
    rows.push(row);
  }
  return rows.join("\n");
}

/** Normalizes an expected-map template literal for comparison with ownersToAscii. */
export function ascii(text: string): string {
  return dedent(text).join("\n");
}
