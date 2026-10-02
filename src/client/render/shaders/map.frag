#version 300 es
// Map pass: terrain + territory fill + borders + capture flash + hover, per screen pixel.
precision highp float;
precision highp int;
precision highp usampler2D;

uniform vec2 uViewport;      // drawing buffer size, device pixels
uniform vec2 uCenter;        // world point (tiles) at the screen center
uniform float uZoom;         // device pixels per tile
uniform vec2 uMapSize;       // tiles
uniform sampler2D uTerrain;  // rgb = terrain color, a = hillshade (0.5 = flat)
uniform usampler2D uOwner;   // r = owner id, g = tick of last capture (mod 65536)
uniform sampler2D uPalette;  // player colors, 256 ids per row
uniform float uTick;         // current tick + fraction of the next one
uniform uint uHoverOwner;
uniform uint uLocalOwner;
uniform float uBorderPx;     // border width, device pixels (constant at every zoom)
uniform vec3 uOcean;

out vec4 outColor;

const float FILL = 0.56;          // territory color over terrain
const float HOVER_FILL = 0.14;    // extra fill on the hovered player's land
const float FLASH_TICKS = 4.0;    // capture flash duration (0.4 s)
const float SHADE_DECODE = 255.0 / 128.0;

uint ownerAt(ivec2 tile) {
  if (tile.x < 0 || tile.y < 0 || tile.x >= int(uMapSize.x) || tile.y >= int(uMapSize.y)) return 0u;
  return texelFetch(uOwner, tile, 0).r;
}

vec3 playerColor(uint id) {
  return texelFetch(uPalette, ivec2(int(id % 256u), int(id / 256u)), 0).rgb;
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  vec2 world = uCenter + (screen - uViewport * 0.5) / uZoom;
  if (world.x < 0.0 || world.y < 0.0 || world.x >= uMapSize.x || world.y >= uMapSize.y) {
    outColor = vec4(uOcean, 1.0);
    return;
  }

  vec4 terrain = texture(uTerrain, world / uMapSize);
  vec3 color = terrain.rgb;
  float shade = terrain.a * SHADE_DECODE;

  ivec2 tile = ivec2(floor(world));
  uvec2 cell = texelFetch(uOwner, tile, 0).rg;
  uint owner = cell.r;
  if (owner != 0u) {
    vec3 own = playerColor(owner);
    color = mix(color, own, FILL + (owner == uHoverOwner ? HOVER_FILL : 0.0));

    // Newly captured tiles flash toward a light tint of the owner's color, then settle.
    float age = mod(uTick - float(cell.g) + 65536.0, 65536.0);
    if (age < FLASH_TICKS) {
      float flash = 1.0 - age / FLASH_TICKS;
      color = mix(color, mix(own, vec3(1.0), 0.5), flash * flash * 0.75);
    }

    // Distance (in tiles) from this pixel to the nearest edge or corner shared with a
    // tile of a different owner; converted to pixels, so borders have the same on-screen
    // width at every zoom level. Each side draws its own half of a shared border.
    vec2 f = world - vec2(tile);
    float d = 1e6;
    if (ownerAt(tile + ivec2(-1, 0)) != owner) d = min(d, f.x);
    if (ownerAt(tile + ivec2(1, 0)) != owner) d = min(d, 1.0 - f.x);
    if (ownerAt(tile + ivec2(0, -1)) != owner) d = min(d, f.y);
    if (ownerAt(tile + ivec2(0, 1)) != owner) d = min(d, 1.0 - f.y);
    if (ownerAt(tile + ivec2(-1, -1)) != owner) d = min(d, length(f));
    if (ownerAt(tile + ivec2(1, -1)) != owner) d = min(d, length(vec2(1.0 - f.x, f.y)));
    if (ownerAt(tile + ivec2(-1, 1)) != owner) d = min(d, length(vec2(f.x, 1.0 - f.y)));
    if (ownerAt(tile + ivec2(1, 1)) != owner) d = min(d, length(1.0 - f));
    float width = uBorderPx * (owner == uLocalOwner ? 1.35 : 1.0);
    float edge = 1.0 - smoothstep(width - 0.75, width + 0.75, d * uZoom);
    vec3 border = owner == uLocalOwner ? mix(own, vec3(1.0), 0.55) : own * 0.5;
    color = mix(color, border, edge);
  }

  outColor = vec4(color * shade, 1.0);
}
