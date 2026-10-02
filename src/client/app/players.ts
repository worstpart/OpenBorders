/**
 * Player names and colors for a new game (presentation only; the simulation just stores
 * the names it is given).
 *
 * The first 15 bot colors are hand-picked to be distinct from each other and from the
 * terrain: no greens (plains), no sandy tans (highlands) and no pale grays (mountains).
 * Big lobbies (milestone 2.0, up to 125 opponents) need more than any hand-picked list
 * can give, so the rest are generated: each next color is the candidate farthest — in a
 * perceptual color space (OKLab) — from every color already in use, the terrain colors
 * and the local player's blue (GAME_DESIGN.md §5.3).
 *
 * Tribes (milestone 2.1) get dull browns and tans instead — earthy, low-saturation colors
 * that read as "filler" at a glance, so the bright nations stand out (as in OpenFront).
 * Nation colors are kept away from those browns.
 *
 * Team games (milestone 2.3) color by team instead: each team has a hue and its members get
 * distinct shades of it — the local player keeps the familiar blue of team 1.
 */

export const LOCAL_PLAYER_COLOR = "#3f8cff";
export const MAX_OPPONENTS = 125;

const HAND_PICKED_COLORS = [
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
  "#3b4252", // slate
  "#f28c8c", // salmon
  "#c9c23a", // olive
  "#f4efe6", // ivory
];

/** Colors a territory must not be mistaken for: plains, highland, mountain (terrainTexture.ts). */
const RESERVED_COLORS = ["#94a874", "#bcb28e", "#a8a49e"];
/** Where the tribe browns live (nation colors keep their distance). */
const TRIBE_REGION = ["#6b5a45", "#8a7558", "#a08a68", "#5a4a3a"];

const BOT_NAMES = [
  "Azure", "Ember", "Rowan", "Sable", "Juniper", "Corsa", "Halden", "Marrow",
  "Vesper", "Lark", "Tamsin", "Orrin", "Brisk", "Cobalt", "Fennick", "Ysolde",
  "Aldmere", "Briar", "Calder", "Dunmore", "Elska", "Faro", "Garnet", "Heron",
  "Jarrow", "Kestrel", "Merrow", "Nettle", "Oakhurst", "Pell", "Quill", "Rook",
  "Sorrel", "Thistle", "Umber", "Vale", "Wren", "Yarrow", "Zephyr", "Alder",
  "Bramble", "Cinder", "Drift", "Esker", "Flint", "Gale", "Hollin", "Ivo",
  "Jasper", "Kelda", "Linden", "Moss", "Norrow", "Ochre", "Pike", "Quarry",
  "Rime", "Slate", "Tarn", "Ulric", "Verge", "Wick", "Yule", "Zarek",
  "Ashby", "Bexley", "Corin", "Delve", "Elmira", "Fallow", "Gorse", "Haven",
  "Ingle", "Jett", "Kiln", "Loch", "Mire", "Nook", "Orla", "Pyre",
  "Rill", "Skye", "Tor", "Udo", "Vane", "Weald", "Arden", "Bly",
  "Cove", "Dale", "Eyre", "Fen", "Glen", "Holt", "Isla", "Kerr",
  "Lyle", "Mead", "Ness", "Oriel", "Peregrine", "Ravel", "Strand", "Tamber",
  "Undine", "Vellum", "Wold", "Beck", "Crag", "Dross", "Eddy", "Ferrow",
  "Grist", "Hale", "Juno", "Knoll", "Lumen", "Marsh", "Nimbus", "Opal",
  "Pallas", "Sedge", "Talon", "Ursa", "Vireo", "Whin", "Yew", "Zinnia",
  "Arbor", "Bastion", "Cairn", "Dorran", "Embry", "Fable", "Gant", "Harrow",
]; // prettier-ignore

/** Invented country names for nations (GAME_DESIGN.md §3.13); tribes use BOT_NAMES. */
const NATION_NAMES = [
  "Valdorra", "Kestria", "Doravia", "Solmere", "Tyrhenia", "Calvaro", "Norvane", "Esteral",
  "Brenmark", "Ostravia", "Quelmar", "Ardenne", "Velloria", "Marovia", "Silvaine", "Torvald",
  "Corvenna", "Halvoria", "Lunmere", "Dravonia", "Sereth", "Umbria Nova", "Kaldoon", "Westmarch",
  "Pellucia", "Ravenmoor", "Istria Vale", "Grenholm", "Aurevon", "Zantara",
]; // prettier-ignore

export const MAX_NATIONS = 25;

/** Picks `count` distinct nation names. */
export function pickNationNames(count: number, random: () => number): string[] {
  return shuffled(NATION_NAMES, random).slice(0, count);
}

/** "Tribe" or "Nation · Medium · turtle", for the hover card. */
export function describeBot(p: {
  tier: string | null;
  difficulty: string | null;
  personality: string | null;
}): string {
  if (p.tier === "tribe") return "Tribe · weak filler";
  const difficulty = p.difficulty ? p.difficulty[0]!.toUpperCase() + p.difficulty.slice(1) : "";
  return ["Nation", difficulty, p.personality].filter(Boolean).join(" · ");
}

function shuffled(list: readonly string[], random: () => number): string[] {
  const names = [...list];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [names[i], names[j]] = [names[j]!, names[i]!];
  }
  return names;
}

/** Picks `count` distinct bot names, shuffled with the given random source. */
export function pickBotNames(count: number, random: () => number): string[] {
  return shuffled(BOT_NAMES, random).slice(0, count);
}

let botColors: string[] = [...HAND_PICKED_COLORS];
let tribeColors: string[] = [];

/**
 * Colors indexed by player id (index 0 = neutral), from each player's tier in id order.
 * Player 1 is the local player. Nations take the bright colors in order, tribes browns.
 */
export function playerColors(tiers: readonly ("human" | "nation" | "tribe")[]): string[] {
  const nations = tiers.slice(1).filter((t) => t !== "tribe").length;
  const tribes = tiers.length - 1 - nations;
  if (nations > botColors.length) botColors = generateBotColors(nations);
  if (tribes > tribeColors.length) tribeColors = generateTribeColors(Math.max(tribes, 64));
  let nextNation = 0;
  let nextTribe = 0;
  return [
    "#000000",
    LOCAL_PLAYER_COLOR,
    ...tiers
      .slice(1)
      .map((t) => (t === "tribe" ? tribeColors[nextTribe++]! : botColors[nextNation++]!)),
  ];
}

/** Dull browns, tans and khakis, farthest-first so neighbours rarely look alike. */
export function generateTribeColors(count: number): string[] {
  const candidates: { hex: string; lab: Lab; nearest: number }[] = [];
  // Darker than the highland terrain (L ≈ 0.75) so tribe land still reads as owned.
  for (const lightness of [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.69]) {
    for (const chroma of [0.025, 0.045, 0.065]) {
      for (let hue = 35; hue <= 95; hue += 6) {
        const angle = (hue * Math.PI) / 180;
        const lab: Lab = [lightness, chroma * Math.cos(angle), chroma * Math.sin(angle)];
        const rgb = labToRgb(lab);
        if (rgb) candidates.push({ hex: rgbToHex(rgb), lab, nearest: Infinity });
      }
    }
  }
  const avoid = [LOCAL_PLAYER_COLOR, ...RESERVED_COLORS].map(hexToLab);
  for (const c of candidates)
    for (const a of avoid) c.nearest = Math.min(c.nearest, labDistance(c.lab, a));
  const colors: string[] = [];
  while (colors.length < count && candidates.length > 0) {
    let best = 0;
    for (let k = 1; k < candidates.length; k++) {
      if (candidates[k]!.nearest > candidates[best]!.nearest) best = k;
    }
    const [pick] = candidates.splice(best, 1);
    colors.push(pick!.hex);
    for (const c of candidates) c.nearest = Math.min(c.nearest, labDistance(c.lab, pick!.lab));
  }
  // More tribes than candidates: reuse the palette (borders still separate them).
  for (let k = 0; colors.length < count; k++) colors.push(colors[k]!);
  return colors;
}

/** Each team's base color (team 1 = the local player's blue); names in teams.ts. */
export const TEAM_COLORS = [
  LOCAL_PLAYER_COLOR,
  "#e0453a", // red
  "#f2c032", // gold
  "#8d5ce6", // violet
  "#1fb5a5", // teal
  "#f08a24", // orange
  "#e04ea0", // pink
  "#7d8597", // slate
];

/**
 * Colors indexed by player id for a team game (index 0 = neutral; player 1 is local).
 * Each team's first member gets the team's base color, the others shades of it; tribes
 * (team 0) get the tribe browns.
 */
export function teamPlayerColors(
  players: readonly { readonly tier: "human" | "nation" | "tribe"; readonly team: number }[],
): string[] {
  const tribes = players.filter((p) => p.tier === "tribe").length;
  if (tribes > tribeColors.length) tribeColors = generateTribeColors(Math.max(tribes, 64));
  const members = new Map<number, number>();
  for (const p of players) if (p.team > 0) members.set(p.team, (members.get(p.team) ?? 0) + 1);
  const shades = new Map<number, string[]>();
  for (const [team, count] of members) {
    const base = TEAM_COLORS[(team - 1) % TEAM_COLORS.length]!;
    shades.set(team, generateTeamShades(base, count));
  }
  const next = new Map<number, number>();
  let nextTribe = 0;
  return [
    "#000000",
    ...players.map((p) => {
      if (p.team === 0) return p.tier === "tribe" ? tribeColors[nextTribe++]! : "#888888";
      const k = next.get(p.team) ?? 0;
      next.set(p.team, k + 1);
      return shades.get(p.team)![k]!;
    }),
  ];
}

/**
 * `count` colors of one team: the base color, then shades of it (lighter, darker, a
 * little warmer or cooler), each the candidate farthest from those already picked and
 * from the terrain and tribe colors. Deterministic.
 */
export function generateTeamShades(base: string, count: number): string[] {
  const colors = [base];
  const [L, A, B] = hexToLab(base);
  const chroma = Math.hypot(A, B);
  const hue = Math.atan2(B, A);
  const candidates: { hex: string; lab: Lab; nearest: number }[] = [];
  for (let lightness = 0.42; lightness <= 0.86; lightness += 0.04) {
    for (const hueShift of [-14, -7, 0, 7, 14]) {
      for (const chromaShare of [1, 0.7]) {
        const angle = hue + (hueShift * Math.PI) / 180;
        // Shrink the chroma until the color fits on screen (very light or dark blues don't).
        for (let c = chroma * chromaShare; c > 0.02; c *= 0.9) {
          const lab: Lab = [lightness, c * Math.cos(angle), c * Math.sin(angle)];
          const rgb = labToRgb(lab);
          if (rgb) {
            candidates.push({ hex: rgbToHex(rgb), lab, nearest: Infinity });
            break;
          }
        }
      }
    }
  }
  const avoid = [base, ...RESERVED_COLORS, ...TRIBE_REGION].map(hexToLab);
  for (const c of candidates)
    for (const a of avoid) c.nearest = Math.min(c.nearest, labDistance(c.lab, a));
  // Favour shades near the base's lightness a little, so a team still reads as one color.
  const score = (c: { lab: Lab; nearest: number }) => c.nearest - 0.15 * Math.abs(c.lab[0] - L);
  while (colors.length < count && candidates.length > 0) {
    let best = 0;
    for (let k = 1; k < candidates.length; k++) {
      if (score(candidates[k]!) > score(candidates[best]!)) best = k;
    }
    const [pick] = candidates.splice(best, 1);
    colors.push(pick!.hex);
    for (const c of candidates) c.nearest = Math.min(c.nearest, labDistance(c.lab, pick!.lab));
  }
  for (let k = 1; colors.length < count; k++) colors.push(colors[k]!);
  return colors;
}

// ---------------------------------------------------------------------------------------
// Color generation (OKLab: distances match how different colors look).

type Lab = readonly [number, number, number];

/** Candidate lightness and chroma levels: dark enough for white labels to stay legible. */
const CANDIDATE_LIGHTNESS = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85];
const CANDIDATE_CHROMA = [0.07, 0.12, 0.17, 0.22];
const CANDIDATE_HUE_STEP = 6;

/** The hand-picked colors, then generated ones until there are `count`. Deterministic. */
export function generateBotColors(count: number): string[] {
  const colors = [...HAND_PICKED_COLORS];
  const used: Lab[] = [LOCAL_PLAYER_COLOR, ...RESERVED_COLORS, ...TRIBE_REGION, ...colors].map(
    hexToLab,
  );
  const candidates: { hex: string; lab: Lab; nearest: number }[] = [];
  for (const lightness of CANDIDATE_LIGHTNESS) {
    for (const chroma of CANDIDATE_CHROMA) {
      for (let hue = 0; hue < 360; hue += CANDIDATE_HUE_STEP) {
        const angle = (hue * Math.PI) / 180;
        const lab: Lab = [lightness, chroma * Math.cos(angle), chroma * Math.sin(angle)];
        const rgb = labToRgb(lab);
        if (!rgb) continue; // outside what a screen can show
        candidates.push({ hex: rgbToHex(rgb), lab, nearest: Infinity });
      }
    }
  }
  for (const c of candidates)
    for (const u of used) c.nearest = Math.min(c.nearest, labDistance(c.lab, u));

  while (colors.length < count && candidates.length > 0) {
    let best = 0;
    for (let k = 1; k < candidates.length; k++) {
      if (candidates[k]!.nearest > candidates[best]!.nearest) best = k;
    }
    const [pick] = candidates.splice(best, 1);
    colors.push(pick!.hex);
    for (const c of candidates) c.nearest = Math.min(c.nearest, labDistance(c.lab, pick!.lab));
  }
  return colors;
}

export function labDistance(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function hexToLab(hex: string): Lab {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → sRGB bytes, or null if the color is out of gamut. */
function labToRgb([L, A, B]: Lab): [number, number, number] | null {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (linear.some((c) => c < -1e-4 || c > 1 + 1e-4)) return null;
  return linear.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(s * 255);
  }) as [number, number, number];
}

function rgbToHex(rgb: readonly number[]): string {
  return "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
}
