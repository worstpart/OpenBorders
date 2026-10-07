/**
 * Map generator check (milestone 2.8): generates each map type at a size for a few seeds,
 * prints generation time, land share and landmass sizes, and writes ¼-scale PNG previews.
 *
 *   node tools/maps.ts <out-dir> [normal|large|huge] [seeds, e.g. 2,11,23]
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { generateMap, MAP_STYLES } from "../src/sim/map/generate.ts";
import { landmassesOf } from "../src/sim/systems/naval.ts";

const SIZES: Record<string, [number, number]> = {
  normal: [1100, 700],
  large: [1560, 990],
  huge: [2200, 1400],
};
const COLORS = [
  [30, 60, 110],
  [90, 170, 90],
  [170, 140, 110],
  [210, 210, 210],
];

const out = process.argv[2];
if (!out) throw new Error("usage: node tools/maps.ts <out-dir> [size] [seeds]");
const sizeName = process.argv[3] ?? "normal";
const [width, height] = SIZES[sizeName] ?? SIZES.normal!;
const seeds = (process.argv[4] ?? "2,11,23").split(",").map(Number);

for (const style of MAP_STYLES) {
  for (const seed of seeds) {
    const startedAt = performance.now();
    const map = generateMap({ seed, width, height, style });
    const ms = performance.now() - startedAt;
    const labels = landmassesOf(map);
    const sizes = new Map<number, number>();
    for (const label of labels) if (label) sizes.set(label, (sizes.get(label) ?? 0) + 1);
    const masses = [...sizes.values()].sort((a, b) => b - a);
    const share = ((100 * map.landTiles) / (width * height)).toFixed(1);
    console.log(
      `${sizeName} ${style} seed ${seed}: ${Math.round(ms)} ms, land ${share}%, ` +
        `${masses.length} landmasses: ${masses.slice(0, 10).join(", ")}`,
    );
    const scale = 4;
    const w = Math.floor(width / scale);
    const h = Math.floor(height / scale);
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = COLORS[map.terrain[y * scale * width + x * scale]!]!;
        raw.set(color, y * (w * 3 + 1) + 1 + x * 3);
      }
    }
    writeFileSync(`${out}/${sizeName}-${style}-${seed}.png`, png(w, h, raw));
  }
}

/** A minimal RGB PNG (one IDAT chunk). */
function png(width: number, height: number, raw: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
