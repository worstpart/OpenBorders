/**
 * The map renderer (WebGL2, see ARCHITECTURE.md §4).
 *
 * Milestone 1.0: owns the canvas, the WebGL2 context and resizing. The terrain,
 * territory, border and label passes are added in milestone 1.2.
 */

export class WebGL2UnavailableError extends Error {
  constructor() {
    super("This browser does not support WebGL2, which the game needs to draw the map.");
    this.name = "WebGL2UnavailableError";
  }
}

export class MapRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly resizeObserver: ResizeObserver;
  private clearColor: [number, number, number] = [0, 0, 0];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      antialias: false, // tiles are drawn as crisp texels; MSAA would only cost fill rate
      alpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new WebGL2UnavailableError();
    this.gl = gl;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  /** Sets the color drawn where there is no map (CSS hex like "#0f1724"). */
  setClearColor(hex: string): void {
    this.clearColor = parseHexColor(hex);
    this.draw();
  }

  /** Matches the drawing buffer to the canvas' size in device pixels, then redraws. */
  resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.draw();
  }

  draw(): void {
    const { gl } = this;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(this.clearColor[0], this.clearColor[1], this.clearColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
  }
}

function parseHexColor(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Expected a 6-digit hex color, got "${hex}"`);
  const value = parseInt(match[1]!, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
