/**
 * The camera: which part of the map is on screen. All screen values are CSS pixels;
 * world values are tiles (fractional). Zoom = CSS pixels per tile.
 *
 * Zooming is smooth: input sets a target zoom around an anchor point (the cursor), and
 * update() eases toward it while keeping the world point under the anchor fixed — the
 * map zooms "into the cursor".
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** How quickly zoom and focus animations settle (per second, exponential). */
const ZOOM_EASE_RATE = 14;
const FOCUS_EASE_RATE = 7;
/** Most zoomed in: one tile = this many CSS pixels. */
const MAX_ZOOM = 48;
/** Most zoomed out, relative to "whole map fits the screen". */
const MIN_ZOOM_OF_FIT = 0.75;

export class Camera {
  /** World point (tiles) at the center of the screen. */
  center: Vec2 = { x: 0, y: 0 };
  zoom = 1;
  private viewport: Vec2 = { x: 1, y: 1 };
  private mapSize: Vec2 = { x: 1, y: 1 };
  private targetZoom = 1;
  private zoomAnchor: Vec2 = { x: 0, y: 0 };
  private focusTarget: Vec2 | null = null;

  setViewport(width: number, height: number): void {
    this.viewport = { x: Math.max(1, width), y: Math.max(1, height) };
    this.clampZoom();
    this.clampCenter();
  }

  get viewportSize(): Readonly<Vec2> {
    return this.viewport;
  }

  /** Sets the map size and shows the whole map. */
  setMap(width: number, height: number): void {
    this.mapSize = { x: width, y: height };
    this.zoom = this.targetZoom = this.fitZoom();
    this.center = { x: width / 2, y: height / 2 };
    this.focusTarget = null;
  }

  /** Zoom at which the whole map fits on screen. */
  fitZoom(): number {
    return Math.min(this.viewport.x / this.mapSize.x, this.viewport.y / this.mapSize.y);
  }

  get minZoom(): number {
    return this.fitZoom() * MIN_ZOOM_OF_FIT;
  }

  get maxZoom(): number {
    return Math.max(MAX_ZOOM, this.minZoom);
  }

  screenToWorld(screen: Vec2): Vec2 {
    return {
      x: this.center.x + (screen.x - this.viewport.x / 2) / this.zoom,
      y: this.center.y + (screen.y - this.viewport.y / 2) / this.zoom,
    };
  }

  worldToScreen(world: Vec2): Vec2 {
    return {
      x: (world.x - this.center.x) * this.zoom + this.viewport.x / 2,
      y: (world.y - this.center.y) * this.zoom + this.viewport.y / 2,
    };
  }

  /** The tile under a screen point, or null outside the map. */
  tileAt(screen: Vec2): { x: number; y: number } | null {
    const world = this.screenToWorld(screen);
    const x = Math.floor(world.x);
    const y = Math.floor(world.y);
    if (x < 0 || y < 0 || x >= this.mapSize.x || y >= this.mapSize.y) return null;
    return { x, y };
  }

  /** Moves the view by a screen-space distance (drag, keyboard). */
  panBy(dxScreen: number, dyScreen: number): void {
    this.center = {
      x: this.center.x - dxScreen / this.zoom,
      y: this.center.y - dyScreen / this.zoom,
    };
    this.focusTarget = null;
    this.clampCenter();
  }

  /** Multiplies the target zoom by `factor`, anchored at a screen point (wheel). */
  zoomAt(factor: number, anchor: Vec2): void {
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
    this.zoomAnchor = anchor;
  }

  /** Smoothly moves the view to center on a world point. */
  focusOn(world: Vec2): void {
    this.focusTarget = { ...world };
  }

  /** Advances animations. Returns true if the view changed. */
  update(dtSeconds: number): boolean {
    let changed = false;
    if (this.zoom !== this.targetZoom) {
      const anchorWorld = this.screenToWorld(this.zoomAnchor);
      // Ease in log space so zooming feels uniform at every scale; snap when nearly there.
      const t = 1 - Math.exp(-ZOOM_EASE_RATE * dtSeconds);
      const eased = Math.exp(
        Math.log(this.zoom) + (Math.log(this.targetZoom) - Math.log(this.zoom)) * t,
      );
      this.zoom =
        Math.abs(this.targetZoom - eased) <= this.targetZoom * 1e-4 ? this.targetZoom : eased;
      // Keep the anchored world point under the anchor.
      this.center = {
        x: anchorWorld.x - (this.zoomAnchor.x - this.viewport.x / 2) / this.zoom,
        y: anchorWorld.y - (this.zoomAnchor.y - this.viewport.y / 2) / this.zoom,
      };
      changed = true;
    }
    if (this.focusTarget) {
      const t = 1 - Math.exp(-FOCUS_EASE_RATE * dtSeconds);
      const target = this.focusTarget;
      const dx = (target.x - this.center.x) * (1 - t);
      const dy = (target.y - this.center.y) * (1 - t);
      if (Math.abs(dx) * this.zoom < 0.5 && Math.abs(dy) * this.zoom < 0.5) {
        this.center = { ...target }; // less than half a pixel left: arrive exactly
        this.focusTarget = null;
      } else {
        this.center = { x: target.x - dx, y: target.y - dy };
      }
      changed = true;
    }
    if (changed) this.clampCenter();
    return changed;
  }

  private clampZoom(): void {
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.targetZoom = clamp(this.targetZoom, this.minZoom, this.maxZoom);
  }

  /** Keeps the map from leaving the screen entirely: the center stays over the map. */
  private clampCenter(): void {
    this.center = {
      x: clamp(this.center.x, 0, this.mapSize.x),
      y: clamp(this.center.y, 0, this.mapSize.y),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
