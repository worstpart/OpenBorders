/**
 * Cleans the user's icon pack (`openborder_icon_pack_final/`, D-028) into the game's sprites
 * in `src/client/assets/icons/`:
 *
 *  1. Captions: 15 of the 24 PNGs still carry a baked-in "LEVEL n / ERA" box (a rounded
 *     rectangle of one navy colour). It is found by colour and cut out. Where it overlapped
 *     a hull (troop boats, the first trade ship), the hull is rebuilt by copying it along
 *     its own slant from just left of the box, and cut off below the hull's bottom edge
 *     (a straight line fitted to the edge left of the box).
 *  2. National markings (the user asked for them gone, 2026-10-06): the roundels and stars
 *     on the planes are masked by colour inside hand-placed circles and filled in from the
 *     paint around them (a smooth harmonic fill — invisible at game sizes).
 *  3. Trimmed to the art and downscaled (area-averaged, premultiplied alpha) to the sizes the
 *     game draws: buildings 96 px, vehicles 80 px on their longest side (2× the largest CSS
 *     size, for sharp sprites on high-DPI screens).
 *
 * The user's second sheet (`sheets/sams_walls_silos_missiles.png`, 2B.1: SAM, wall, Missile
 * Silo art I–III and seven missiles) has a transparent background: each sprite is cut out by
 * its box on the sheet (only the largest piece of art in the box is kept — no neighbours,
 * headings or loose captions), then cleaned the same way.
 *
 * Run: `node tools/iconPack.mjs [packDir] [outDir] [--preview file.png]`. Deterministic: the
 * same pack gives the same files.
 */
import fs from "node:fs";
import path from "node:path";
import { blank, blit, readPng, writePng } from "./png.mjs";

const args = process.argv.slice(2);
const previewAt = args.indexOf("--preview");
const preview = previewAt >= 0 ? args.splice(previewAt, 2)[1] : null;
const packDir = args[0] ?? "openborder_icon_pack_final";
const outDir = args[1] ?? "src/client/assets/icons";

/** Pack folder → sprite name, and the longest side it is stored at. */
const SPRITES = [
  ["buildings/housing", "housing", 96],
  ["buildings/factories", "factory", 96],
  ["buildings/ports", "port", 96],
  ["buildings/airports", "airport", 96],
  ["vehicles/airplanes", "plane", 80],
  ["vehicles/helicopters", "helicopter", 80],
  ["vehicles/attack_boats_with_troops", "boat", 80],
  ["vehicles/trade_ships", "tradeShip", 80],
];
const ERAS = ["level_1_ww1", "level_2_ww2", "level_3_modern"];

/** The second sheet: sprite name → its box on the sheet [x0, y0, x1, y1] and longest side. */
const SHEET = "sheets/sams_walls_silos_missiles.png";
const SHEET_SPRITES = [
  ["sam-1", [300, 30, 620, 285], 96],
  ["sam-2", [640, 15, 980, 285], 96],
  ["sam-3", [995, 0, 1410, 285], 96],
  ["wall-1", [310, 300, 665, 525], 96],
  ["wall-2", [670, 295, 1075, 525], 96],
  ["wall-3", [1085, 285, 1515, 525], 96],
  ["silo-1", [300, 520, 660, 778], 96],
  ["silo-2", [662, 520, 1068, 778], 96],
  ["silo-3", [1080, 520, 1515, 778], 96],
  ["missile-1", [70, 830, 250, 945], 80],
  ["missile-2", [265, 825, 455, 945], 80],
  ["missile-3", [470, 815, 672, 945], 80],
  ["cruiseMissile", [680, 830, 900, 950], 80],
  ["airToAirMissile", [905, 830, 1120, 950], 80],
  ["airToGroundMissile", [1115, 825, 1320, 950], 80],
  ["icbm", [1320, 800, 1515, 960], 80],
];

/** Sprites whose caption covered part of the hull. */
const HULLS = new Set(["boat", "tradeShip"]);

/** Markings to paint over, in the pack's pixel coordinates: [x, y, radius, "all" = every
 * pixel but the dark outline, else only marking-coloured ones]. */
const MARKINGS = {
  "plane-1": [
    [147, 39, 14], // roundels on the upper wing
    [57, 81, 14],
  ],
  "plane-2": [
    [177, 52, 13], // stars on the wings and fuselage
    [70, 115, 14],
    [81, 69, 10, "all"],
    [50, 41, 16, "all"], // the tricolour rudder: all of it but its dark outline
  ],
};

const luma = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

/** A pixel that belongs to a marking: saturated red, white, or blue paint. */
function markingPaint(r, g, b) {
  const red = r > 90 && r > 3 * g && r - g > 60;
  const white = Math.min(r, g, b) > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 60;
  const blue = b - r > 25 && b > 80 && b >= g;
  return red || white || blue;
}

// ---------------------------------------------------------------------------------------

/** Caption fill colours: the first pack's, and the second sheet's. */
const PACK_NAVY = [16, 32, 48];
const SHEET_NAVY = [24, 33, 42];

/** The caption box: the largest blob of its navy fill, as an inclusive rectangle. */
function findCaption(img, [nr, ng, nb]) {
  const { width: w, height: h, data } = img;
  const navy = (p) => {
    const i = p * 4;
    return (
      data[i + 3] > 200 &&
      Math.abs(data[i] - nr) <= 7 &&
      Math.abs(data[i + 1] - ng) <= 7 &&
      Math.abs(data[i + 2] - nb) <= 9
    );
  };
  const seen = new Uint8Array(w * h);
  let best = null;
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || !navy(p)) continue;
    const stack = [p];
    seen[p] = 1;
    const box = { n: 0, x0: w, x1: 0, y0: h, y1: 0 };
    while (stack.length) {
      const q = stack.pop();
      const x = q % w;
      const y = (q / w) | 0;
      box.n++;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx;
        if (!seen[r] && navy(r)) {
          seen[r] = 1;
          stack.push(r);
        }
      }
    }
    if (box.n > 1500 && (!best || box.n > best.n)) best = box;
  }
  if (!best) return null;
  // The box has a soft rim: take a few pixels around it too.
  const pad = 3;
  return {
    pad,
    x0: Math.max(0, best.x0 - pad),
    x1: Math.min(w - 1, best.x1 + pad),
    y0: Math.max(0, best.y0 - pad),
    y1: Math.min(h - 1, best.y1 + pad),
  };
}

const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

/**
 * Cuts the caption out (`hull`: rebuilds the hull it covered — see the header). Returns
 * what it did.
 */
function removeCaption(img, box, hull) {
  const { width: w, height: h, data } = img;
  if (hull) {
    // Copy each covered pixel from one box-width to the left, along the hull's slant (lines
    // on a hull are parallel to its bottom edge), so the hull and its texture continue and
    // end at the same bottom edge.
    const { slope } = bottomEdge(img, box.x0 - 32, box.x0 - 3);
    const shift = box.x1 - box.x0 + 2;
    const src = new Uint8Array(data);
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const sx = x - shift;
        const sy = Math.round(y - shift * slope);
        const d = (y * w + x) * 4;
        if (sx < 0 || sy < 0 || sy >= h) data[d + 3] = 0;
        else data.set(src.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), d);
      }
    }
    return `hull rebuilt (slope ${slope.toFixed(2)})`;
  }
  // The box itself, and its soft rim (navy-ish or see-through pixels just around it) — but
  // not the art that comes close to it.
  const { pad } = box;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const i = (y * w + x) * 4;
      const inner =
        x >= box.x0 + pad && x <= box.x1 - pad && y >= box.y0 + pad && y <= box.y1 - pad;
      const navyish =
        Math.abs(data[i] - 16) + Math.abs(data[i + 1] - 32) + Math.abs(data[i + 2] - 48) < 70;
      if (inner || navyish || data[i + 3] < 200) data[i + 3] = 0;
    }
  }
  // Did the box hide the bottom corner of an isometric ground tile (the airports)? Its two
  // bottom edges, fitted beside the box, meet under it: continue each edge (and the paint
  // along it) to the corner.
  const left = bottomEdge(img, box.x0 - 32, box.x0 - 3);
  const right = bottomEdge(img, box.x1 + 3, box.x1 + 32);
  const diamond =
    left &&
    right &&
    left.slope > 0.3 &&
    left.slope < 0.8 &&
    right.slope < -0.3 &&
    right.slope > -0.8;
  if (!diamond) return "cut";
  const tipX = (right.at0 - left.at0) / (left.slope - right.slope);
  const tipY = left.slope * tipX + left.at0;
  if (tipY <= box.y0 || tipX <= box.x0 || tipX >= box.x1) return "cut";
  const src = new Uint8Array(data);
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const d = (y * w + x) * 4;
      if (src[d + 3] > 0) continue;
      const sx = x <= tipX ? box.x0 - 3 : box.x1 + 3;
      const sy = Math.round(x <= tipX ? y - (x - sx) * left.slope : y + (sx - x) * right.slope);
      if (sy >= 0 && sy < h) data.set(src.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), d);
    }
  }
  return `cut, ground corner rebuilt at ${Math.round(tipX)},${Math.round(tipY)}`;
}

/** The line through the lowest solid pixel of columns x0..x1: y = slope·x + at0. */
function bottomEdge(img, x0, x1) {
  const xs = [];
  const ys = [];
  for (let x = Math.max(0, x0); x <= Math.min(img.width - 1, x1); x++) {
    for (let y = img.height - 1; y >= 0; y--) {
      if (alphaAt(img, x, y) > 128) {
        xs.push(x);
        ys.push(y);
        break;
      }
    }
  }
  const n = xs.length;
  if (n < 8) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < n; k++) {
    sxy += (xs[k] - mx) * (ys[k] - my);
    sxx += (xs[k] - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, at0: my - slope * mx };
}

/** Paints over markings inside the given circles with a harmonic fill from around them. */
function paintOver(img, circles) {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);
  for (const [cx, cy, radius, all] of circles) {
    for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
        const i = (y * w + x) * 4;
        const [r, g, b] = data.subarray(i, i + 3);
        const paint = markingPaint(r, g, b) || (all && luma(r, g, b) > 55);
        if (data[i + 3] > 128 && paint) mask[y * w + x] = 1;
      }
    }
  }
  // Grow by one pixel (the blended edge of the marking), staying on solid paint.
  const grown = new Uint8Array(mask);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (mask[p] || data[p * 4 + 3] <= 128) continue;
      if (mask[p - 1] || mask[p + 1] || mask[p - w] || mask[p + w]) grown[p] = 1;
    }
  }
  const pixels = [];
  for (let p = 0; p < w * h; p++) if (grown[p]) pixels.push(p);
  // Fill from the paint, not from outlines and panel lines (dark pixels) or the background.
  const source = (q) =>
    data[q * 4 + 3] > 128 &&
    (grown[q] || luma(data[q * 4], data[q * 4 + 1], data[q * 4 + 2]) >= 55);
  // Start by growing the paint around inwards, ring by ring (so a marking that touches the
  // paint on one side only — a rudder — still fills from it), then relax (Jacobi) towards a
  // smooth fill.
  const color = new Float64Array(w * h * 3);
  for (let p = 0; p < w * h; p++) for (let c = 0; c < 3; c++) color[p * 3 + c] = data[p * 4 + c];
  const filled = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) filled[p] = grown[p] ? 0 : 1;
  for (let left = pixels.filter((p) => !filled[p]); left.length;) {
    const ring = left.filter((p) =>
      [p - 1, p + 1, p - w, p + w].some((q) => filled[q] && source(q)),
    );
    if (ring.length === 0) break;
    for (const p of ring) {
      const sum = [0, 0, 0];
      let count = 0;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (!filled[q] || !source(q)) continue;
        for (let c = 0; c < 3; c++) sum[c] += color[q * 3 + c];
        count++;
      }
      for (let c = 0; c < 3; c++) color[p * 3 + c] = sum[c] / count;
    }
    for (const p of ring) filled[p] = 1;
    left = left.filter((p) => !filled[p]);
  }
  for (let iteration = 0; iteration < 200; iteration++) {
    for (const p of pixels) {
      const sum = [0, 0, 0];
      let count = 0;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (!source(q)) continue;
        for (let c = 0; c < 3; c++) sum[c] += color[q * 3 + c];
        count++;
      }
      if (count) for (let c = 0; c < 3; c++) color[p * 3 + c] = sum[c] / count;
    }
  }
  for (const p of pixels)
    for (let c = 0; c < 3; c++) data[p * 4 + c] = Math.round(color[p * 3 + c]);
  return pixels.length;
}

/** Drops specks that are not connected to the main art (left over by cropping). */
function dropSpecks(img) {
  const { width: w, height: h, data } = img;
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  for (let p = 0; p < w * h; p++) {
    if (label[p] >= 0 || data[p * 4 + 3] <= 8) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [p];
    label[p] = id;
    while (stack.length) {
      const q = stack.pop();
      size++;
      const x = q % w;
      const y = (q / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const r = ny * w + nx;
          if (label[r] < 0 && data[r * 4 + 3] > 8) {
            label[r] = id;
            stack.push(r);
          }
        }
      }
    }
    sizes.push(size);
  }
  const keep = sizes.indexOf(Math.max(...sizes));
  let dropped = 0;
  for (let p = 0; p < w * h; p++) {
    // Keep the main art and any sizeable part (smoke puffs, rotor tips).
    if (label[p] >= 0 && label[p] !== keep && sizes[label[p]] < 40) {
      data[p * 4 + 3] = 0;
      dropped++;
    }
  }
  return dropped;
}

/** The part of `img` inside [x0, y0, x1, y1] (inclusive). */
function crop(img, [x0, y0, x1, y1]) {
  const out = blank(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = y0; y <= y1; y++) {
    const from = (y * img.width + x0) * 4;
    out.data.set(img.data.subarray(from, from + out.width * 4), (y - y0) * out.width * 4);
  }
  return out;
}

/** Keeps only the largest connected piece of art (8-connected, alpha > 8). */
function keepLargest(img) {
  const { width: w, height: h, data } = img;
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  for (let p = 0; p < w * h; p++) {
    if (label[p] >= 0 || data[p * 4 + 3] <= 8) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [p];
    label[p] = id;
    while (stack.length) {
      const q = stack.pop();
      size++;
      const x = q % w;
      const y = (q / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const r = ny * w + nx;
          if (label[r] < 0 && data[r * 4 + 3] > 8) {
            label[r] = id;
            stack.push(r);
          }
        }
      }
    }
    sizes.push(size);
  }
  const keep = sizes.indexOf(Math.max(...sizes));
  for (let p = 0; p < w * h; p++) if (label[p] !== keep) data[p * 4 + 3] = 0;
}

/** Crops to the visible art plus a 1 px margin. */
function trim(img) {
  const { width: w, height: h } = img;
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alphaAt(img, x, y) > 8) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  const out = blank(x1 - x0 + 3, y1 - y0 + 3);
  for (let y = y0; y <= y1; y++) {
    const from = (y * w + x0) * 4;
    out.data.set(
      img.data.subarray(from, from + (x1 - x0 + 1) * 4),
      ((y - y0 + 1) * out.width + 1) * 4,
    );
  }
  return out;
}

/** Area-averaged downscale (premultiplied alpha, so edges don't darken). */
function downscale(img, longest) {
  const scale = longest / Math.max(img.width, img.height);
  if (scale >= 1) return img;
  const W = Math.max(1, Math.round(img.width * scale));
  const H = Math.max(1, Math.round(img.height * scale));
  const fx = img.width / W;
  const fy = img.height / H;
  const out = blank(W, H);
  for (let Y = 0; Y < H; Y++) {
    const sy0 = Y * fy;
    const sy1 = sy0 + fy;
    for (let X = 0; X < W; X++) {
      const sx0 = X * fx;
      const sx1 = sx0 + fx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
        const wy = Math.min(sy1, y + 1) - Math.max(sy0, y);
        for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
          const wx = Math.min(sx1, x + 1) - Math.max(sx0, x);
          const weight = wx * wy;
          const i = (y * img.width + x) * 4;
          const alpha = img.data[i + 3] / 255;
          r += img.data[i] * alpha * weight;
          g += img.data[i + 1] * alpha * weight;
          b += img.data[i + 2] * alpha * weight;
          a += alpha * weight;
          area += weight;
        }
      }
      const o = (Y * W + X) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a);
        out.data[o + 1] = Math.round(g / a);
        out.data[o + 2] = Math.round(b / a);
      }
      out.data[o + 3] = Math.round((a / area) * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------

fs.mkdirSync(outDir, { recursive: true });
const results = [];
let total = 0;
/** Cleans one sprite (see the header) and writes it as `<key>.png`. */
function clean(img, key, name, longest, navy) {
  const notes = [];
  const box = findCaption(img, navy);
  if (box) notes.push(`caption ${removeCaption(img, box, HULLS.has(name))}`);
  if (MARKINGS[key]) notes.push(`markings ${paintOver(img, MARKINGS[key])} px`);
  const specks = dropSpecks(img);
  if (specks) notes.push(`${specks} speck px`);
  const full = trim(img);
  const small = downscale(full, longest);
  const bytes = writePng(small);
  fs.writeFileSync(path.join(outDir, `${key}.png`), bytes);
  total += bytes.length;
  results.push({ key, full, small });
  console.log(
    `${key.padEnd(18)} ${String(small.width).padStart(3)}×${String(small.height).padEnd(3)} ${String(bytes.length).padStart(6)} B  ${notes.join(", ")}`,
  );
}

for (const [folder, name, longest] of SPRITES) {
  ERAS.forEach((era, k) => {
    const file = path.join(packDir, folder, era, `${path.basename(folder)}_${era}.png`);
    clean(readPng(fs.readFileSync(file)), `${name}-${k + 1}`, name, longest, PACK_NAVY);
  });
}
const sheet = readPng(fs.readFileSync(path.join(packDir, SHEET)));
for (const [key, box, longest] of SHEET_SPRITES) {
  const img = crop(sheet, box);
  keepLargest(img);
  clean(img, key, key.replace(/-\d$/, ""), longest, SHEET_NAVY);
}
console.log(`${results.length} sprites, ${(total / 1024).toFixed(1)} KiB`);

if (preview) {
  // A check sheet: every cleaned sprite at full resolution, 4 per row, on a dark checkerboard.
  const cell = Math.max(...results.map(({ full }) => Math.max(full.width, full.height))) + 4;
  const sheet = blank(cell * 4, cell * Math.ceil(results.length / 4));
  for (let p = 0; p < sheet.width * sheet.height; p++) {
    const v = (((p % sheet.width) >> 4) + ((p / sheet.width) >> 4)) % 2 ? 70 : 92;
    sheet.data.set([v, v + 10, v + 30, 255], p * 4);
  }
  results.forEach(({ full }, k) => {
    const flat = blank(full.width, full.height);
    const ox = (k % 4) * cell;
    const oy = Math.floor(k / 4) * cell;
    for (let y = 0; y < full.height; y++) {
      for (let x = 0; x < full.width; x++) {
        const s = (y * full.width + x) * 4;
        const d = ((oy + y) * sheet.width + ox + x) * 4;
        const a = full.data[s + 3] / 255;
        for (let c = 0; c < 3; c++) {
          flat.data[s + c] = Math.round(full.data[s + c] * a + sheet.data[d + c] * (1 - a));
        }
        flat.data[s + 3] = 255;
      }
    }
    blit(sheet, flat, ox, oy);
  });
  fs.writeFileSync(preview, writePng(sheet));
}
