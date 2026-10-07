/**
 * The painted sprites (D-028): the user's icon pack, cleaned by `tools/iconPack.mjs` into
 * `assets/icons/<kind>-<level>.png` — buildings and vehicles, one per level, the eras WW1 →
 * WW2 → Modern standing for levels I → III. The map draws them on Canvas2D (render/), the
 * HUD as plain images (BuildingIcon.svelte). Things without art yet (SAM, Missile Silo,
 * walls, warships, missiles) keep their drawings in icons.ts.
 *
 * The isometric art does not rotate well, so vehicles are mirrored left/right by heading
 * instead. Each image is loaded once; for the map it is also kept pre-shrunk to the sizes
 * drawn (halving step by step: one big shrink in drawImage blurs fine detail away).
 */
export type SpriteKind =
  "housing" | "factory" | "port" | "airport" | "plane" | "helicopter" | "boat" | "tradeShip";

/** Which way each vehicle's art faces (its nose or bow), so it can be mirrored to match. */
export const FACES_LEFT: Readonly<Partial<Record<SpriteKind, boolean>>> = {
  boat: true,
  tradeShip: true,
  plane: false,
  helicopter: false,
};

const URLS = import.meta.glob<string>("./assets/icons/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const clampLevel = (level: number) => Math.min(3, Math.max(1, Math.round(level)));

/** The image URL of a sprite (a building under construction, level 0, shows level I). */
export function spriteUrl(kind: SpriteKind, level: number): string {
  const url = URLS[`./assets/icons/${kind}-${clampLevel(level)}.png`];
  if (url === undefined) throw new Error(`No sprite ${kind}-${level}`);
  return url;
}

/** Loaded sprites and their shrunk copies (browser only). */
class SpriteCache {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly shrunk = new Map<string, HTMLCanvasElement>();

  /** Starts loading every sprite, so none pops in late. */
  preload(): void {
    for (const path of Object.keys(URLS)) {
      const key = path.slice("./assets/icons/".length, -".png".length);
      this.image(key);
    }
  }

  private image(key: string): HTMLImageElement | null {
    let image = this.images.get(key);
    if (!image) {
      const url = URLS[`./assets/icons/${key}.png`];
      if (url === undefined) return null;
      image = new Image();
      image.decoding = "async";
      image.src = url;
      this.images.set(key, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }

  /**
   * The sprite shrunk to `width` device pixels (rounded to even sizes, so zooming makes few
   * copies), or null while it is still loading.
   */
  get(kind: SpriteKind, level: number, width: number): HTMLImageElement | HTMLCanvasElement | null {
    const key = `${kind}-${clampLevel(level)}`;
    const image = this.image(key);
    if (!image) return null;
    const w = Math.max(2, Math.round(width / 2) * 2);
    if (w >= image.naturalWidth) return image;
    const sizeKey = `${key}@${w}`;
    let canvas = this.shrunk.get(sizeKey);
    if (!canvas) {
      canvas = shrink(image, w);
      this.shrunk.set(sizeKey, canvas);
    }
    return canvas;
  }
}

function shrink(image: HTMLImageElement, width: number): HTMLCanvasElement {
  let source: HTMLImageElement | HTMLCanvasElement = image;
  let w = image.naturalWidth;
  let h = image.naturalHeight;
  const height = Math.max(1, Math.round((h * width) / w));
  for (;;) {
    const half = w / 2 >= width;
    const nw = half ? Math.round(w / 2) : width;
    const nh = half ? Math.round(h / 2) : height;
    const canvas = document.createElement("canvas");
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, nw, nh);
    if (!half) return canvas;
    source = canvas;
    w = nw;
    h = nh;
  }
}

export const sprites = new SpriteCache();

/**
 * Draws a sprite `width` CSS px wide, its centre at (x, y); `flip` mirrors it left/right.
 * Returns false (drawing nothing) while the image is still loading.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  kind: SpriteKind,
  level: number,
  x: number,
  y: number,
  width: number,
  flip = false,
): boolean {
  const ratio = window.devicePixelRatio || 1;
  const image = sprites.get(kind, level, width * ratio);
  if (!image) return false;
  const height = (width * image.height) / image.width;
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
  return true;
}

/** A sprite's height for a given width (its art's aspect), or `width` before it loads. */
export function spriteHeight(kind: SpriteKind, level: number, width: number): number {
  const image = sprites.get(kind, level, 1e9);
  return image ? (width * image.height) / image.width : width;
}
