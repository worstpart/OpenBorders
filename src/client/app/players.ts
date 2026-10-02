/**
 * Player names and colors for a new game (presentation only; the simulation just stores
 * the names it is given).
 *
 * Colors are hand-picked to be distinct from each other and from the terrain: no greens
 * (plains), no sandy tans (highlands) and no pale grays (mountains). Phase 1 assigns them
 * in this order; a perceptual allocator comes with larger player counts.
 */

export const LOCAL_PLAYER_COLOR = "#3f8cff";

const BOT_COLORS = [
  "#e0453a", // red
  "#f2c032", // saffron
  "#8d5ce6", // violet
  "#1fb5a5", // teal
  "#e04ea0", // pink
  "#f08a24", // orange
  "#4b4fc4", // indigo
  "#29b3e0", // sky
  "#a3203f", // crimson
  "#b54fd1", // magenta
  "#9a4b28", // rust
  "#3b4252", // slate
  "#f28c8c", // salmon
  "#c9c23a", // olive
  "#f4efe6", // ivory
];

const BOT_NAMES = [
  "Azure",
  "Ember",
  "Rowan",
  "Sable",
  "Juniper",
  "Corsa",
  "Halden",
  "Marrow",
  "Vesper",
  "Lark",
  "Tamsin",
  "Orrin",
  "Brisk",
  "Cobalt",
  "Fennick",
  "Ysolde",
];

export const MAX_OPPONENTS = BOT_COLORS.length;

/** Picks `count` distinct bot names, shuffled with the given random source. */
export function pickBotNames(count: number, random: () => number): string[] {
  const names = [...BOT_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [names[i], names[j]] = [names[j]!, names[i]!];
  }
  return names.slice(0, count);
}

/** Colors indexed by player id (index 0 = neutral). Player 1 is the local player. */
export function playerColors(playerCount: number): string[] {
  return ["#000000", LOCAL_PLAYER_COLOR, ...BOT_COLORS.slice(0, playerCount - 1)];
}
