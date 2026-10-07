/**
 * Building icons (GAME_DESIGN.md §3.17.10): one original drawing per building and level, as
 * SVG path data in a 24 × 24 box, filled with the even-odd rule (windows and doors are
 * holes). The same paths are drawn on the map (Canvas2D Path2D) and in the HUD (inline
 * SVG), so a building looks the same everywhere. Each level adds detail: a house → a street
 * → a skyline; a workshop → a plant → a smoking industrial complex; a palisade → a
 * crenellated wall → a fortress tower between walls (the wall tool, D-024); a boat at a pier
 * → a pier with a crane (Port).
 */
import type { BuildingType } from "../sim/rules.ts";
import type { Placeable } from "./app/buildings.ts";

const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`;
const puff = (x: number, y: number, r: number) =>
  `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

const HOUSE_1 = [
  "M4 11.5L12 4.5L20 11.5V20H4Z", // house
  "M15.2 5.2H17.2V9.05L15.2 7.3Z", // chimney, down to the roof line (no overlap = no hole)
  rect(10.5, 15, 3, 5), // door (hole)
  rect(6.5, 13, 2.5, 2.5), // windows (holes)
  rect(15, 13, 2.5, 2.5),
].join("");

const HOUSE_2 = [
  "M1.5 13.5L6.5 9L11.5 13.5V20.5H1.5Z",
  rect(5.3, 17, 2.4, 3.5),
  rect(3, 14.5, 1.8, 1.8),
  rect(8.2, 14.5, 1.8, 1.8),
  "M12 11L17.25 6L22.5 11V20.5H12Z",
  "M19.3 6.4H21V9.57L19.3 7.95Z",
  rect(16, 16.5, 2.5, 4),
  rect(13.8, 12.6, 2, 2),
  rect(18.7, 12.6, 2, 2),
].join("");

const towerWindows = [6.5, 9.5, 12.5, 15.5]
  .flatMap((y) => [rect(10.4, y, 1.3, 1.8), rect(12.3, y, 1.3, 1.8)])
  .join("");
const HOUSE_3 = [
  rect(9.2, 4.5, 5.6, 16), // tower
  rect(11.6, 1.5, 0.8, 3), // antenna
  towerWindows,
  rect(2.5, 10.5, 5.8, 10), // left block
  rect(3.8, 12.5, 1.3, 1.6),
  rect(5.8, 12.5, 1.3, 1.6),
  rect(3.8, 15.5, 1.3, 1.6),
  rect(5.8, 15.5, 1.3, 1.6),
  "M15.7 20.5V9L21.5 6.5V20.5Z", // right block, slanted roof
  rect(17, 11.5, 1.3, 1.6),
  rect(19.2, 11.5, 1.3, 1.6),
  rect(17, 14.5, 1.3, 1.6),
  rect(19.2, 14.5, 1.3, 1.6),
  rect(1.5, 20.5, 21, 1.5), // street
].join("");

/** A saw-tooth hall from x = 2.5 to 21.5 with `chimneys` chimneys and `smoke` puffs. */
function factory(
  chimneys: readonly [number, number][],
  smoke: readonly [number, number, number][],
  wide: boolean,
): string {
  const hall = wide
    ? "M2 20.5V12L6.5 9V12L11 9V12L15.5 9V12H22V20.5Z"
    : "M2.5 20.5V12.5L7.5 9.5V12.5L12.5 9.5V12.5H21.5V20.5Z";
  const windows = (wide ? [4, 8.5, 13] : [5, 10]).map((x) => rect(x, 14.5, 2.4, 2.2)).join("");
  return [
    hall,
    windows,
    rect(wide ? 18.2 : 16.8, 16, 2.6, 4.5), // door (hole)
    ...chimneys.map(([x, top]) => rect(x, top, 2, (wide ? 12 : 12.5) - top)),
    ...smoke.map(([x, y, r]) => puff(x, y, r)),
  ].join("");
}

const FACTORY_1 = factory([[17.5, 4.5]], [], false);
const FACTORY_2 = factory(
  [
    [15, 5.5],
    [18.6, 3.5],
  ],
  [[19.6, 1.8, 1.1]],
  false,
);
const FACTORY_3 = factory(
  [
    [16.2, 5],
    [18.6, 3],
    [21, 4.5],
  ],
  [
    [17.2, 3.2, 1],
    [19.6, 1.4, 1.1],
  ],
  true,
);

/** Wall I (Palisade): pointed stakes. */
const POST_1 = [
  ...[2.5, 6.3, 10.1, 13.9, 17.7].map((x) => `M${x} 19.5V10.5L${x + 1.9} 7L${x + 3.8} 10.5V19.5Z`),
  rect(2, 20, 20, 1.5), // ground
].join("");

/** Wall II (Stone Wall): a crenellated wall with firing slits and a gate. */
const POST_2 = [
  "M2 20.5V9H5V11.5H8V9H11V11.5H13V9H16V11.5H19V9H22V20.5Z",
  rect(4.5, 14.5, 3.5, 1.6), // slits (holes)
  rect(16, 14.5, 3.5, 1.6),
  "M10.5 20.5V17.5A1.5 1.5 0 0 1 13.5 17.5V20.5Z", // gate
].join("");

/** Wall III (Fortress Wall): a fortress tower with a flag between two walls. */
const POST_3 = [
  "M8 20.5V4H10V6H11V4H13V6H14V4H16V20.5Z", // tower
  rect(11.7, 0.6, 0.6, 3.4), // flag pole
  "M12.3 0.6L15.6 1.7L12.3 2.8Z", // flag
  rect(11.2, 8.5, 1.6, 3.5), // tower slit (hole)
  "M10.5 20.5V17.5A1.5 1.5 0 0 1 13.5 17.5V20.5Z", // gate
  "M1.5 20.5V11H3V12.5H4.5V11H6V12.5H7.5V20.5Z", // left wall
  "M16.5 20.5V12.5H18V11H19.5V12.5H21V11H22.5V20.5Z", // right wall
  rect(3, 15, 3, 1.4), // wall slits (holes)
  rect(18, 15, 3, 1.4),
].join("");

/** Port I: a sailing boat beside a pier on posts (GAME_DESIGN.md §3.18). */
const PIER = [
  rect(12, 15, 10.5, 1.6), // deck
  rect(13, 16.6, 1.2, 3.6), // posts
  rect(16.8, 16.6, 1.2, 3.6),
  rect(20.6, 16.6, 1.2, 3.6),
].join("");
const PORT_1 = [
  PIER,
  "M2 15.5H12.5L10.6 18.8H4Z", // hull
  rect(6.6, 5.5, 0.9, 10), // mast
  "M7.5 6L11.6 14.5H7.5Z", // sail
  "M1.5 20.5H22.5V21.8H1.5Z", // water line
].join("");
/** Port II (Naval Port): the pier gets a crane lifting a crate. */
const PORT_2 = [
  PIER,
  "M2 15.5H11.5L9.8 18.8H3.7Z",
  rect(5.9, 6.5, 0.9, 9),
  "M6.8 7L10.4 14.5H6.8Z",
  rect(17, 4.4, 1.4, 10.6), // crane mast, down to the deck
  rect(13.5, 3, 9.5, 1.4), // crane arm
  rect(21.4, 4.4, 0.5, 3.6), // cable
  rect(20.4, 8, 2.5, 2.2), // crate
  "M1.5 20.5H22.5V21.8H1.5Z",
].join("");

export const BUILDING_ICONS: Readonly<Record<BuildingType, readonly [string, string, string]>> = {
  housing: [HOUSE_1, HOUSE_2, HOUSE_3],
  factory: [FACTORY_1, FACTORY_2, FACTORY_3],
  // Level III (Naval Base) comes with Phase 2B; until then nothing reaches it.
  port: [PORT_1, PORT_2, PORT_2],
};

/** The wall tool and wall cards (GAME_DESIGN.md §3.17.6). */
export const WALL_ICONS: readonly [string, string, string] = [POST_1, POST_2, POST_3];

/** The icon path for a building at `level` (a building under construction shows level 1). */
export function iconPath(type: Placeable, level: number): string {
  const set = type === "wall" ? WALL_ICONS : BUILDING_ICONS[type];
  return set[Math.min(3, Math.max(1, level)) - 1]!;
}
