/**
 * The map renderer (WebGL2, ARCHITECTURE.md §4, D-003).
 *
 * Push-based: it never reads simulation state. The session hands it the map once, then
 * tile changes per tick, player colors, hover and the camera view each frame.
 *
 * Textures:
 *   terrain  RGBA8, static, mipmapped (color + hillshade)
 *   owner    RG16UI: owner id and the tick it was captured (for the capture flash)
 *   palette  RGBA8: one color per player id
 * Ownership changes mark 32×32-tile blocks dirty; only dirty blocks are uploaded.
 */
import type { GameMap } from "../../sim/map/gameMap.ts";
import mapFragmentSource from "./shaders/map.frag?raw";
import mapVertexSource from "./shaders/map.vert?raw";
import { buildTerrainTexels, OCEAN_COLOR } from "./terrainTexture.ts";

export class WebGL2UnavailableError extends Error {
  constructor() {
    super("This browser does not support WebGL2, which the game needs to draw the map.");
    this.name = "WebGL2UnavailableError";
  }
}

/** What part of the world to draw. Center in tiles, zoom in CSS pixels per tile. */
export interface MapView {
  centerX: number;
  centerY: number;
  zoom: number;
}

const BLOCK = 32;
/** Border width in CSS pixels. */
const BORDER_CSS_PX = 1.25;
const PALETTE_ROW = 256;

type UniformName =
  | "uViewport"
  | "uCenter"
  | "uZoom"
  | "uMapSize"
  | "uTerrain"
  | "uOwner"
  | "uPalette"
  | "uTick"
  | "uHoverOwner"
  | "uLocalOwner"
  | "uBorderPx"
  | "uOcean";

interface MapState {
  width: number;
  height: number;
  /** Interleaved [owner, captureTick] per tile — the CPU copy of the owner texture. */
  ownerCapture: Uint16Array;
  dirtyBlocks: Uint8Array;
  dirtyList: number[];
  blocksX: number;
}

export class MapRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<UniformName, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private terrainTexture: WebGLTexture | null = null;
  private ownerTexture: WebGLTexture | null = null;
  private paletteTexture: WebGLTexture | null = null;
  private map: MapState | null = null;
  private hoverOwner = 0;
  private localOwner = 0;
  /** Time spent uploading tile changes during the last frame, in ms. */
  lastUploadMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: false, // the shader antialiases borders itself
      alpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new WebGL2UnavailableError();
    this.gl = gl;
    this.program = linkProgram(gl, mapVertexSource, mapFragmentSource);
    const names: UniformName[] = [
      "uViewport",
      "uCenter",
      "uZoom",
      "uMapSize",
      "uTerrain",
      "uOwner",
      "uPalette",
      "uTick",
      "uHoverOwner",
      "uLocalOwner",
      "uBorderPx",
      "uOcean",
    ];
    this.uniforms = Object.fromEntries(
      names.map((name) => [name, gl.getUniformLocation(this.program, name)]),
    ) as Record<UniformName, WebGLUniformLocation | null>;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Could not create a vertex array");
    this.vao = vao;
  }

  /** Matches the drawing buffer to the canvas' CSS size × device pixel ratio. */
  resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /** Loads a new map with its current ownership (full upload). */
  setMap(map: GameMap, owner: Uint16Array): void {
    const { gl } = this;
    const { width, height } = map;
    this.deleteMapTextures();

    this.terrainTexture = createTexture(gl, gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      buildTerrainTexels(map),
    );
    gl.generateMipmap(gl.TEXTURE_2D);

    const ownerCapture = new Uint16Array(width * height * 2);
    for (let tile = 0; tile < owner.length; tile++) ownerCapture[tile * 2] = owner[tile]!;
    this.ownerTexture = createTexture(gl, gl.NEAREST, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RG16UI,
      width,
      height,
      0,
      gl.RG_INTEGER,
      gl.UNSIGNED_SHORT,
      ownerCapture,
    );

    const blocksX = Math.ceil(width / BLOCK);
    this.map = {
      width,
      height,
      ownerCapture,
      dirtyBlocks: new Uint8Array(blocksX * Math.ceil(height / BLOCK)),
      dirtyList: [],
      blocksX,
    };
  }

  /** Records ownership changes from one tick; uploaded on the next render. */
  applyTileChanges(tiles: Int32Array, owners: Uint16Array, tick: number): void {
    const map = this.map;
    if (!map) return;
    const captureTick = tick & 0xffff;
    for (let k = 0; k < tiles.length; k++) {
      const tile = tiles[k]!;
      map.ownerCapture[tile * 2] = owners[k]!;
      map.ownerCapture[tile * 2 + 1] = captureTick;
      const block =
        Math.floor((tile % map.width) / BLOCK) + Math.floor(tile / map.width / BLOCK) * map.blocksX;
      if (map.dirtyBlocks[block] === 0) {
        map.dirtyBlocks[block] = 1;
        map.dirtyList.push(block);
      }
    }
  }

  /** Colors per player id as "#rrggbb" (index 0 = neutral, unused). */
  setPlayerColors(colors: readonly string[]): void {
    const { gl } = this;
    const rows = Math.max(1, Math.ceil(colors.length / PALETTE_ROW));
    const texels = new Uint8Array(PALETTE_ROW * rows * 4);
    colors.forEach((hex, id) => {
      const [r, g, b] = parseHexColor(hex);
      texels.set([r, g, b, 255], id * 4);
    });
    if (this.paletteTexture) gl.deleteTexture(this.paletteTexture);
    this.paletteTexture = createTexture(gl, gl.NEAREST, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      PALETTE_ROW,
      rows,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      texels,
    );
  }

  setHoverOwner(owner: number): void {
    this.hoverOwner = owner;
  }

  setLocalOwner(owner: number): void {
    this.localOwner = owner;
  }

  /** Draws one frame. `tick` may be fractional (current tick + progress toward the next). */
  render(view: MapView, tick: number): void {
    const { gl } = this;
    const ratio = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.uploadDirtyBlocks();

    if (!this.map || !this.terrainTexture || !this.ownerTexture || !this.paletteTexture) {
      gl.clearColor(OCEAN_COLOR[0] / 255, OCEAN_COLOR[1] / 255, OCEAN_COLOR[2] / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    const u = this.uniforms;
    gl.useProgram(this.program);
    gl.uniform2f(u.uViewport, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uCenter, view.centerX, view.centerY);
    gl.uniform1f(u.uZoom, view.zoom * ratio);
    gl.uniform2f(u.uMapSize, this.map.width, this.map.height);
    gl.uniform1f(u.uTick, tick % 65536);
    gl.uniform1ui(u.uHoverOwner, this.hoverOwner);
    gl.uniform1ui(u.uLocalOwner, this.localOwner);
    gl.uniform1f(u.uBorderPx, BORDER_CSS_PX * ratio);
    gl.uniform3f(u.uOcean, OCEAN_COLOR[0] / 255, OCEAN_COLOR[1] / 255, OCEAN_COLOR[2] / 255);
    bindTexture(gl, 0, this.terrainTexture, u.uTerrain);
    bindTexture(gl, 1, this.ownerTexture, u.uOwner);
    bindTexture(gl, 2, this.paletteTexture, u.uPalette);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.deleteMapTextures();
    if (this.paletteTexture) this.gl.deleteTexture(this.paletteTexture);
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }

  private uploadDirtyBlocks(): void {
    const map = this.map;
    if (!map || map.dirtyList.length === 0 || !this.ownerTexture) {
      this.lastUploadMs = 0;
      return;
    }
    const startedAt = performance.now();
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.ownerTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, map.width);
    for (const block of map.dirtyList) {
      const x = (block % map.blocksX) * BLOCK;
      const y = Math.floor(block / map.blocksX) * BLOCK;
      const w = Math.min(BLOCK, map.width - x);
      const h = Math.min(BLOCK, map.height - y);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        x,
        y,
        w,
        h,
        gl.RG_INTEGER,
        gl.UNSIGNED_SHORT,
        map.ownerCapture,
      );
      map.dirtyBlocks[block] = 0;
    }
    map.dirtyList.length = 0;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    this.lastUploadMs = performance.now() - startedAt;
  }

  private deleteMapTextures(): void {
    if (this.terrainTexture) this.gl.deleteTexture(this.terrainTexture);
    if (this.ownerTexture) this.gl.deleteTexture(this.ownerTexture);
    this.terrainTexture = null;
    this.ownerTexture = null;
    this.map = null;
  }
}

function createTexture(
  gl: WebGL2RenderingContext,
  minFilter: number,
  magFilter: number,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Could not create a texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function bindTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
  location: WebGLUniformLocation | null,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(location, unit);
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Could not create a shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link error: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

export function parseHexColor(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Expected a 6-digit hex color, got "${hex}"`);
  const value = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
