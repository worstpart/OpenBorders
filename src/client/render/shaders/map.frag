#version 300 es
// Map pass: terrain + territory fill + borders + fronts + growth + hover, per pixel.
precision highp float;
precision highp int;
precision highp usampler2D;

uniform vec2 uViewport;      // drawing buffer size, device pixels
uniform vec2 uCenter;        // world point (tiles) at the screen center
uniform float uZoom;         // device pixels per tile
uniform vec2 uMapSize;       // tiles
uniform sampler2D uTerrain;  // rgb = terrain color, a = hillshade (0.5 = flat)
uniform usampler2D uOwner;   // r = owner id (WATER for water), g = tick of last capture
uniform sampler2D uPalette;  // player colors, 256 ids per row; a = flags (1 ally, 2 traitor,
                             // bits 2–7: strength of the gold capture effect, 0–63)
uniform sampler2D uWar;      // r > 0 at (attacker, target): attacker is attacking target
uniform uint uWarSize;       // players + 1
uniform float uTick;         // current tick + fraction of the next one
uniform float uSeconds;      // wall-clock seconds, for pulsing
uniform uint uHoverOwner;
uniform uint uLocalOwner;
uniform float uBorderPx;     // border width, device pixels (constant at every zoom)
uniform vec3 uOcean;

out vec4 outColor;

const uint WATER = 65535u;
const float FILL = 0.56;            // territory color over terrain
const float HOVER_FILL = 0.14;      // extra fill on the hovered player's land
const float GROW_TICKS = 8.0;       // freshly taken land grows in over 0.8 s
const float VEIN_SCALE = 0.3;       // growth veins: about one every 3 tiles (two octaves)
const float FRONT_MIN_WIDTH = 6.0;  // front glow width when zoomed out, in border widths
const float FRONT_TILES = 0.85;     // ...and at least this share of a tile when zoomed in
const vec3 ATTACK_RED = vec3(1.0, 0.16, 0.12);
const vec3 ALLY_MINT = vec3(0.62, 1.0, 0.84);   // the local player's allies' borders
const vec3 TRAITOR_CORAL = vec3(1.0, 0.42, 0.34); // stripes over a traitor's land
const vec3 LOOT_GOLD = vec3(1.0, 0.8, 0.3);      // a capture's gold flowing in (§3.16)
const uint FLAG_ALLY = 1u;
const uint FLAG_TRAITOR = 2u;
const float SHADE_DECODE = 255.0 / 128.0;

uint ownerAt(ivec2 tile) {
  if (tile.x < 0 || tile.y < 0 || tile.x >= int(uMapSize.x) || tile.y >= int(uMapSize.y)) return WATER;
  return texelFetch(uOwner, tile, 0).r;
}

vec3 playerColor(uint id) {
  return texelFetch(uPalette, ivec2(int(id % 256u), int(id / 256u)), 0).rgb;
}

uint playerFlags(uint id) {
  return uint(texelFetch(uPalette, ivec2(int(id % 256u), int(id / 256u)), 0).a * 255.0 + 0.5);
}

bool isAttacking(uint attacker, uint target) {
  if (attacker >= uWarSize || target >= uWarSize) return false;
  return texelFetch(uWar, ivec2(int(attacker), int(target)), 0).r > 0.5;
}

// Keeps the nearest edge/corner (in tiles) shared with a different owner.
void consider(uint neighbor, float dist, uint owner, inout float nearest, inout uint nearestOwner) {
  if (neighbor != owner && dist < nearest) {
    nearest = dist;
    nearestOwner = neighbor;
  }
}

// Integer hash → [0, 1] (no sin(), so it looks the same on every GPU).
float hash(ivec2 p) {
  uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) * (1.0 / 4294967295.0);
}

float valueNoise(vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + ivec2(1, 0));
  float c = hash(i + ivec2(0, 1));
  float d = hash(i + ivec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 0 on thin, branching vein lines (where the noise crosses its middle), up to 1 between.
float veins(vec2 p) {
  float n = valueNoise(p) * 0.6 + valueNoise(p * 2.7 + 17.0) * 0.4;
  return min(1.0, abs(n * 2.0 - 1.0) * 3.0);
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
  if (owner != 0u && owner != WATER) {
    vec3 own = playerColor(owner);

    // Freshly taken land grows in like a living thing: the new color first runs along
    // thin branching veins, which glow, thicken and merge until the tile is filled.
    float age = mod(uTick - float(cell.g) + 65536.0, 65536.0);
    float grown = 1.0;
    float glowing = 0.0;
    if (age < GROW_TICKS) {
      float progress = age / GROW_TICKS;
      float v = veins(world * VEIN_SCALE);
      // Veins appear almost at once; the space between fills over the rest of the time.
      grown = smoothstep(v - 0.1, v + 0.1, progress * progress * 1.3 + 0.05);
      glowing = grown * (1.0 - progress);
    }
    uint flags = playerFlags(owner);
    // Just captured a whole player (GAME_DESIGN.md §3.16): their gold pours in — the
    // new land grows in gold and the capturer's border shimmers gold for a moment.
    float loot = float(flags >> 2u) / 63.0;
    float sweep = 0.5 + 0.5 * sin((screen.x + screen.y) / (uBorderPx * 10.0) - uSeconds * 9.0);
    color = mix(color, own, (FILL + (owner == uHoverOwner ? HOVER_FILL : 0.0)) * grown);
    color = mix(color, mix(mix(own, vec3(1.0), 0.55), LOOT_GOLD, min(1.0, loot * 2.0)), glowing * 0.8);

    // Traitors (GAME_DESIGN.md §3.14): slowly moving coral stripes, the same width on
    // screen at every zoom, for as long as the mark lasts.
    if ((flags & FLAG_TRAITOR) != 0u) {
      float period = uBorderPx * 9.0;
      float phase = fract((screen.x + screen.y) / period - uSeconds * 0.5);
      float stripe = smoothstep(0.42, 0.5, phase) * (1.0 - smoothstep(0.92, 1.0, phase));
      color = mix(color, TRAITOR_CORAL, stripe * 0.32 * grown);
    }

    // Distance (in tiles) from this pixel to the nearest edge or corner shared with a
    // tile of a different owner; converted to pixels, so borders have the same on-screen
    // width at every zoom level. Each side draws its own half of a shared border.
    vec2 f = world - vec2(tile);
    float d = 1e6;
    uint other = owner;
    consider(ownerAt(tile + ivec2(-1, 0)), f.x, owner, d, other);
    consider(ownerAt(tile + ivec2(1, 0)), 1.0 - f.x, owner, d, other);
    consider(ownerAt(tile + ivec2(0, -1)), f.y, owner, d, other);
    consider(ownerAt(tile + ivec2(0, 1)), 1.0 - f.y, owner, d, other);
    consider(ownerAt(tile + ivec2(-1, -1)), length(f), owner, d, other);
    consider(ownerAt(tile + ivec2(1, -1)), length(vec2(1.0 - f.x, f.y)), owner, d, other);
    consider(ownerAt(tile + ivec2(-1, 1)), length(vec2(f.x, 1.0 - f.y)), owner, d, other);
    consider(ownerAt(tile + ivec2(1, 1)), length(1.0 - f), owner, d, other);
    float dPx = d * uZoom;

    // Fronts. Land under attack by another player glows red — brightest where you are
    // involved (your attacks, or attacks on you); an expansion into neutral land glows
    // softly in the expanding player's own color.
    bool underAttack = other != 0u && other != WATER && isAttacking(other, owner);
    bool expanding = other == 0u && isAttacking(owner, 0u);
    if (underAttack || expanding) {
      float pulse = 0.7 + 0.3 * sin(uSeconds * 6.0);
      float width = max(uBorderPx * FRONT_MIN_WIDTH, uZoom * FRONT_TILES);
      float glow = 1.0 - smoothstep(0.0, width, dPx);
      if (underAttack) {
        float strength = owner == uLocalOwner || other == uLocalOwner ? 0.85 : 0.5;
        color = mix(color, ATTACK_RED, glow * pulse * strength);
      } else {
        color = mix(color, mix(own, vec3(1.0), 0.3), glow * pulse * 0.45);
      }
    }

    bool ally = (flags & FLAG_ALLY) != 0u;
    float width = uBorderPx * (owner == uLocalOwner ? 1.35 : ally ? 1.3 : 1.0) * (1.0 + 1.2 * loot);
    float edge = (1.0 - smoothstep(width - 0.75, width + 0.75, dPx)) * grown;
    vec3 border = owner == uLocalOwner ? mix(own, vec3(1.0), 0.55)
                : ally ? mix(own, ALLY_MINT, 0.8)
                : own * 0.5;
    if (loot > 0.0) {
      float band = 1.0 - smoothstep(0.0, uBorderPx * 7.0, dPx);
      color = mix(color, LOOT_GOLD, band * loot * (0.25 + 0.3 * sweep));
      border = mix(border, mix(LOOT_GOLD, vec3(1.0), sweep * 0.45), loot);
    }
    color = mix(color, border, edge);
  }

  outColor = vec4(color * shade, 1.0);
}
