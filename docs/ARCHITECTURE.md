# Architecture

> **Status:** initial proposal (Phase 0). Decisions referenced as D-xxx are recorded in
> `DECISIONS.md`. Items marked *Proposed* await confirmation.

---

## 1. Goals & constraints

| Goal | Consequence for architecture |
|---|---|
| Playable vertical slice first, multiplayer later | Build the **command → turn → simulation** pipeline from day one, run it locally in Phase 1 |
| Server ultimately authoritative | Simulation is a pure, deterministic library that can run in the browser **and** in Node |
| Large maps, many players, 60 fps | Typed-array world state, GPU rendering, simulation off the main thread when needed |
| Premium, animated, minimal UI | A reactive UI layer with first-class transitions; renderer owns all map visuals |
| Testable rules | Simulation has zero DOM/rendering dependencies; tiny test maps; golden tests |
| Don't overengineer the MVP | One package, few dependencies, interfaces only where a second implementation is planned |

---

## 2. Overview

```
                         ┌─────────────────────────── Browser ──────────────────────────┐
  keyboard/mouse/touch ─▶│ input/  ──actions──▶ app/ (session) ──commands──▶ host/      │
                         │                        │   ▲                         │        │
                         │                        │   │ view model              │ turns  │
                         │  ui/ (Svelte HUD) ◀────┘   │ (per tick)              ▼        │
                         │                            │              ┌────────────────┐ │
                         │  render/ (WebGL2) ◀── tile deltas ─────────│  sim/ (pure TS │ │
                         │  camera/                   │              │  deterministic)│ │
                         │                            └── events ────│  rules, systems│ │
                         │                                           │  AI            │ │
                         │                                           └────────────────┘ │
                         └──────────────────────────────────────────────────────────────┘
                                         Phase 3: host/ talks to ▼
                         ┌─────────────────────── Node server ──────────────────────────┐
                         │ validates & stamps commands → schedules turns → broadcasts   │
                         │ runs the same sim/ authoritatively (outcomes, resync, rejoin)│
                         └──────────────────────────────────────────────────────────────┘
```

**Data flow per tick (Phase 1, all local):**
1. Input produces an *action* (e.g., "attack at tile 52,311 with 25%").
2. The session turns it into a **command** and hands it to the **host**.
3. The host's turn scheduler collects commands and every 100 ms delivers a **turn**
   (tick number + commands, each stamped with its player ID) to the simulation.
4. The simulation runs its systems in a fixed order and returns a **tick frame**:
   changed tiles, per-player stats, attack states, events.
5. The renderer uploads changed tiles to the GPU; the UI store updates numbers;
   events become toasts/effects.

---

## 3. Technology stack

| Concern | Choice | Why | Alternatives considered |
|---|---|---|---|
| Language | **TypeScript (strict)** | One language for simulation, client and server; the same simulation code runs in browser and Node; types catch mistakes early | Plain JS (no safety net); Rust→WASM (fast, but slower iteration, harder to read, interop cost — revisit only if profiling demands it) |
| Build / dev server | **Vite** | Instant reload, native TS, Web Workers and raw `.glsl` imports out of the box | Webpack (slower, more config); bare esbuild (no dev server conveniences) |
| Map rendering | **WebGL2, hand-written thin layer** | See §4: benchmark evidence + polish requirements + OpenFront's experience | Canvas2D, PixiJS, Phaser, Three.js, WebGPU (§4.3) |
| Map labels | **Canvas2D overlay** (Phase 1) → SDF text in WebGL if needed | < 100 labels per frame is trivial in 2D; crisp text with no font-atlas work | DOM labels (layout cost every frame), SDF text now (complexity we don't need yet) |
| UI | **Svelte 5** | Fine-grained reactivity (a troop count updates one text node, not a component tree), built-in transitions and tweened values for polish, scoped CSS, tiny runtime, readable HTML-like templates | React (heavier re-render model at 10 Hz updates), Lit (OpenFront's choice; fine but less ergonomic), Solid / Preact+signals (good alternatives), vanilla DOM (won't scale to menus) |
| Styling | **Plain CSS + design tokens** (CSS custom properties) | A bespoke premium look with full control and no utility-class soup | Tailwind (fast to build with, but tends to a generic look) |
| Tests | **Vitest** | Shares Vite config, fast, TS-native, works headless in Node | Jest |
| Network validation (Phase 3) | **Zod** (or Valibot) | Every network message is untrusted input | Hand-written checks |
| Server (Phase 3) | **Node 24 LTS + `ws`** | Runs the identical simulation; minimal moving parts | Bun/Deno (fine; Node is most mature), uWebSockets.js (later, for scale), Colyseus (room framework with its own state-sync model we don't want) |
| Formatting | **Prettier**, TypeScript strict mode | Low ceremony; ESLint added only if we need custom rules | Biome |

**Runtime requirement: Node 24 LTS** (installed 24.19.0; see `DECISIONS.md` D-013).

**Tool versions (milestone 1.0):** Vite 8, Vitest 5, Svelte 5.57, svelte-check 4,
Prettier 3. TypeScript is pinned to **6.0.x** because `svelte-check` does not yet support
TypeScript 7 (the new native compiler); revisit when it does.

---

## 4. Rendering architecture

### 4.1 Requirements

- Draw up to ~8M tiles; thousands of ownership changes per tick (10 ticks/s).
- Smooth pan/zoom at 60+ fps from "whole map" to "individual tiles".
- Polish: capture animations, glowing fronts, hover highlights, constant-width borders
  at every zoom, terrain visible under territory.
- Keep the main thread free for UI and input.

### 4.2 Benchmark (Phase 0 spike)

`spikes/render-benchmark/index.html` (+ `serve.mjs` so URL parameters work) draws a
synthetic world with continuous pan/zoom and random ownership changes spread across
the whole map (the worst case for partial uploads), comparing:

- **Canvas2D:** CPU writes RGBA pixels (with border detection) → `putImageData` of the
  dirty band → `drawImage` with a transform each frame.
- **WebGL2:** owner IDs in an `R16UI` texture → `texSubImage2D` of the dirty band →
  one full-screen shader pass does palette lookup + border detection.
- **fx mode:** newly captured tiles flash and fade over 0.5 s. Canvas2D must recolor
  and re-upload those pixels **every frame**; WebGL2 uploads a "captured-at" texture
  once per tick and animates in the shader.

**Results** — Chrome 152, Windows 11, 1344×1274 viewport @1×, 165 Hz display
(frame-rate cap ≈ 164 fps), 10 ticks/s, 8 s per run:

| Scenario | Renderer | Avg FPS | p95 frame | Tick CPU (avg) | Frame CPU (avg) |
|---|---|---|---|---|---|
| 2M tiles, 64 players, 8k changes/tick | Canvas2D | 164.8 | 6.2 ms | 1.37 ms | 0.09 ms |
| | WebGL2 | 163.7 | 6.2 ms | **0.47 ms** | 0.08 ms |
| same + capture animation | Canvas2D | 164.7 | 6.2 ms | 1.59 ms | **2.65 ms** |
| | WebGL2 | 164.2 | 6.2 ms | 0.95 ms | **0.08 ms** |
| 8.4M tiles, 200 players, 20k changes/tick | Canvas2D | 164.1 | 6.2 ms | 3.91 ms | 0.08 ms |
| | WebGL2 | 164.3 | 6.2 ms | **2.18 ms** | 0.08 ms |
| same + capture animation | Canvas2D | **81.5** | **18.2 ms** | 6.68 ms | **10.7 ms** |
| | WebGL2 | **164.2** | **6.2 ms** | 6.74 ms | **0.07 ms** |

**What this tells us (honestly):**
- For a *static-looking* map, modern Chrome Canvas2D is not a bottleneck on this
  machine, even at 8M tiles. Raw throughput alone would not justify WebGL.
- The difference is **polish**. Any per-pixel animation in Canvas2D costs main-thread
  CPU proportional to (animated pixels × frame rate): 2.65 ms/frame at 2M tiles
  (~44% of a core at 165 Hz) and 10.7 ms/frame at 8M tiles, where it **halved the
  frame rate** and produced stutter (p95 18 ms > 16.7 ms budget). WebGL2's per-frame
  CPU stayed flat at ~0.08 ms in every scenario because effects run on the GPU.
- WebGL2's remaining cost is the per-tick upload in the extreme scenario (6.7 ms when
  most of an 8M map changes every tick). Known fixes: block-level dirty tracking,
  packing owner + capture time in one texture, spreading uploads across frames.
- Caveats: one machine, Chromium only (the built-in browser), GPU time not measured
  directly. OpenFront documented Canvas2D problems specifically in **Firefox**
  (issues #440, #893). The benchmark stays in the repo so we can re-run it on a
  low-end laptop and in Firefox/Safari.

### 4.3 Decision: WebGL2 with our own thin layer (D-003)

| Option | Verdict |
|---|---|
| **Canvas2D** | Fine for static maps; per-pixel polish costs main-thread CPU every frame (measured); OpenFront outgrew it |
| **WebGL2 (raw)** ✅ | Flat per-frame cost, effects in shaders, universal browser support (~97%+), full control; ~a few hundred lines for the core |
| **PixiJS** | A sprite/scene-graph engine; our hard part is a tile texture + custom shader, which we'd write anyway inside Pixi. Useful later only if we add many sprites — and OpenFront moved *off* it |
| **Phaser** | Full game framework (scenes, physics, tilemaps as sprites); we'd use ~10% of it and fight its tilemap model at millions of tiles |
| **Three.js** | 3D engine; would work (a plane with a custom shader) but adds ~600 KB and 3D concepts for a 2D map |
| **WebGPU** | Better compute, but support is still less universal than WebGL2; revisit later behind the same renderer interface |

### 4.4 Render pipeline (Phase 1)

| Pass | Input | Notes |
|---|---|---|
| 1. Terrain | static terrain texture (elevation class + shade) | colors + hillshade computed once at load |
| 2. Territory + borders | `R16UI` owner texture, palette texture, capture-time texture | owner color blended over terrain; borders where neighbors differ, constant screen-space width (thin line along tile edges when zoomed in, per-tile when zoomed out); capture flash; hover highlight |
| 3. Fronts | frontier tiles of active attacks (texture or derived) | pulsing glow in attacker color |
| 4. Labels | name/troops/position per player | Canvas2D overlay, world→screen each frame |

- **Uploads:** per tick, only changed tiles' rows/blocks; spawn phase does a full upload.
- **Renderer API is push-based:** the renderer never reads simulation state; it receives
  `applyTileChanges(changes)`, `setPalette(...)`, `setHover(owner)`, `setCamera(...)`.
- **Frame loop:** `requestAnimationFrame`; the renderer interpolates animations from the
  fractional time since the last tick.
- **Performance overlay** (toggle key): FPS, frame CPU, tick ms, upload ms.

**As built (milestone 1.2):**
- *Owner texture* is `RG16UI`: owner id + the tick the tile was last captured (mod
  65,536), so the capture flash is animated entirely in the shader. Changes mark
  32×32-tile blocks dirty; only dirty blocks are uploaded (`UNPACK_ROW_LENGTH`/`SKIP`).
- *Terrain texture* is `RGBA8`, mipmapped: color in RGB, hillshade in alpha (computed
  once from blurred relief), so relief stays visible under territory colors. Water color
  comes from distance to the coast, so the open ocean blends into the area outside the map.
- *Borders*: per pixel, the distance to the nearest edge or corner shared with a different
  owner (8 neighbors), converted to screen pixels → constant on-screen width at every zoom;
  each side draws its own half (two-tone frontiers). The local player's border is lighter
  and slightly wider.
- *Labels*: chamfer distance transform on a 4× downsampled owner grid → deepest point of
  each territory (tied cells averaged, then refined to the local centroid), recomputed at
  most every 250 ms; drawn on a Canvas2D overlay, sized to fit, faded out when tiny.
- Measured (Chrome, 1345×1274, 8 players, spawn phase + troop growth): **0.11 ms CPU per
  frame**, 0.06 ms per tick, display-capped 165 fps. With a 1,000-tile expansion running
  (milestone 1.3): 0.19 ms CPU per frame, 0.10 ms per tick.
- *Fronts*: an R8 "who attacks whom" texture (players × players). Where a tile's nearest
  differing neighbour is fighting it, a pulsing band in the attacker's color (at least
  6 border widths, or 0.85 of a tile when zoomed in). Water tiles get a renderer-only
  owner id so coasts never count as neutral land.
- *Dev-only debug hook* (`window.__borderline`, absent from production builds): set game
  speed, pause/resume, read the latest frame, send commands — used for scripted browser
  checks.

---

## 5. Simulation architecture

### 5.1 Principles

- **Pure and deterministic:** given the same seed and the same commands in the same
  ticks, every machine produces bit-identical state. No DOM, no network, no timers,
  no external dependencies.
- **Single source of rules:** every tunable number lives in `GameRules` with a comment
  explaining why.
- **Systems in a fixed, documented order** rather than an unordered bag of objects.
- **Commands are the only input.** UI, AI and (later) the network all produce the same
  command types.

### 5.2 World state (sketch)

```ts
interface World {
  tick: number;
  phase: "spawn" | "playing" | "ended";
  rules: GameRules;
  map: GameMap;            // width, height, terrain: Uint8Array, owner: Uint16Array
  players: Player[];       // index = player id (1..n); 0 = neutral
  attacks: Attack[];       // active attacks (army, focus tile, frontier, queue)
  rng: Rng;                // seeded, serializable
  winner: PlayerId | null;
}
```

- Tiles are integer indices `y * width + x`; terrain and ownership are typed arrays.
- Players track `homeTroops`, `fieldTroops`, `tiles` (count), border tile set.
- Stored quantities (troops, tile counts) are integers.

### 5.3 Tick order

```
1. applyCommands     validate & apply this turn's commands (spawn, attack, retreat)
2. resolveCollisions opposing attacks cancel; same-target attacks merge
3. advanceAttacks    each attack conquers tiles until its per-tick budget is spent
4. encircle          staggered: annex fully enclosed pockets
5. eliminate         players below the threshold are absorbed; 0 tiles → dead
                     (after encircle, so an annexed player is out in the same tick)
6. growTroops        capacity & regeneration
7. thinkAI           bots emit commands for the NEXT tick (same validation path)
8. checkVictory
9. emitFrame         tile changes, player stats, attack states, events, state hash
```

AI runs **inside** the deterministic simulation (like OpenFront), so bots cost no
network traffic and behave identically on every machine.

### 5.4 Determinism rules (enforced by tests)

- No `Math.random`, `Date`, `performance.now`, or timers in `src/sim`.
- No `Math.pow / exp / log / sin / cos / tan / atan2 / hypot / cbrt` in `src/sim` — JS
  engines may differ in the last bit; use `sim/math/detmath.ts` (implemented with only
  `+ − × ÷`, which IEEE 754 defines exactly) or precomputed tables.
- Ordered iteration only (arrays; `Map`/`Set` insertion order is fine if insertion order
  is deterministic); comparators always have an ID tie-breaker.
- A state **hash** is produced every N ticks for tests (and later for desync checks).

### 5.4.1 Implementation notes (milestone 1.1)

- **Player ids:** `1..n`, `0` = neutral; `world.players[id − 1]`. Owner ids live in a
  `Uint16Array`, so a game has at most 65,535 players.
- **One choke point for ownership:** `setOwner()` updates tile counts, the change log for
  the tick frame and the ownership hash together, so they can't drift apart.
- **Incremental state hash:** every (tile, owner) pair has a pseudo-random 32-bit value;
  the ownership hash is their XOR, updated in O(1) per change. The full state hash
  (`hashWorld`) adds tick, phase, players and RNG state and is cheap enough for every tick.
- **Frames are copies** (`changedTiles` / `changedOwners` typed arrays, player snapshots),
  never views into the live world — ready to be posted from a worker later.
- **Math:** `detmath.ts` implements `log`, `exp` and `pow` with + − × ÷ only (accurate to
  ~1e-15); `rng.ts` is sfc32 (32-bit integer ops). Map noise uses integer hashing and
  polynomial interpolation.
- **Node-runnable:** `tsconfig` sets `erasableSyntaxOnly` (no enums, namespaces or
  constructor parameter properties), so `tools/` can run simulation code with plain
  `node` (Node 24 strips types natively). Enum-like values use `as const` objects.

### 5.4.2 Attacks as built (milestone 1.3)

- `world.attacks`: one army per (attacker, target) pair (0 = neutral land), processed in
  launch order. Each has a *front*: a min-heap (`TileQueue`, ties by insertion order) of
  (ready time, tile) plus a map of each tile's current ready time; superseded heap
  entries are skipped when popped. Ready times chain from the time a tile actually fell,
  so the 10 Hz tick only decides when we look, not the front's shape.
- Per tick: `resolveCollisions` (opposing armies subtract), then `advanceAttacks` (take
  every ready tile the army can pay for; bring retreating armies home). Field troops
  are recomputed from the armies every tick, so they can never drift.
- `setOwner` also maintains each player's **border set** (owned tiles touching a
  different owner); attacks seed their fronts from it. A test checks it against a full
  recomputation.
- Encirclement flood-fills a player's pieces from their border tiles (every piece has
  one) using shared scratch arrays; a per-player "something changed next to my land" flag
  skips checks that would find nothing. Measured on the reference map over a full game
  (scripted player, 7 idle bots): tick **0.20 ms avg, 3.4 ms p99, 6 ms max** — the spikes
  are floods of a ~300k-tile territory.
- Troop amounts are plain numbers (not integers) computed only with + − × ÷ and
  `Math.sqrt`, all exactly rounded by IEEE 754 → still bit-identical everywhere.

### 5.5 Commands (Phase 1)

| Command | Payload | Notes |
|---|---|---|
| `spawn` | tile | only during spawn phase; validated; picking again moves the spawn |
| `confirmSpawn` | — | locks in the spawn; the match starts when every human has confirmed |
| `retreat` | attack id | the army stops at once and returns after 2 s (−20% from players) |
| `attack` | target (player or neutral), **percent** (basis points), focus tile | the sim computes troops from the *current* home pool at execution time — clients never send absolute troop numbers |
| `retreat` | attack id | |

### 5.6 Host abstraction

```ts
interface SimHost {
  start(setup: GameSetup): Promise<InitialState>;
  send(command: Command): void;                 // scheduled into a future turn
  onFrame(listener: (frame: TickFrame) => void): Unsubscribe;
  pause(): void; resume(): void; setSpeed(multiplier: number): void; // local only
}
```

| Implementation | When | What it does |
|---|---|---|
| `LocalHost` | Phase 1 | Turn scheduler + simulation on the main thread (simplest to debug) |
| `WorkerHost` | when profiling says so (likely Phase 2, larger maps) | Same, inside a Web Worker; frames posted as transferable typed arrays |
| `NetworkHost` | Phase 3 | Commands go to the server; turns come back; local sim in a worker |

Because the renderer and UI only ever consume `TickFrame`s, swapping hosts doesn't
touch them.

---

## 6. Client architecture

| Module | Responsibility | Must not |
|---|---|---|
| `app/` | Screens (menu → game → results), session lifecycle, wiring host ↔ renderer ↔ UI | Contain game rules |
| `input/` | Pointer/keyboard/touch → semantic actions (click vs drag threshold, wheel, pinch, keymap) | Know about rendering or rules |
| `camera/` | Position/zoom state, smooth zoom-to-cursor, bounds, focus animations | — |
| `render/` | WebGL2 passes, shaders, textures, labels, perf overlay | Read simulation internals |
| `ui/` | Svelte components (HUD, menus), design tokens, stores updated from frames | Mutate game state (only dispatch actions) |
| `audio/` | Phase 4 | — |

UI stores update at most once per tick; anything faster (smooth bars, counters) is done
with CSS/Svelte tweens, not more updates. No per-frame DOM writes.

---

## 7. Multiplayer plan (Phase 3) — *Proposed* (D-006)

### 7.1 Options

| | A. Relay lockstep (OpenFront) | B. Authoritative server + state deltas | **C. Hybrid authoritative lockstep** |
|---|---|---|---|
| Server simulates | No | Yes | **Yes** |
| Bandwidth | Tiny (commands only) | High: big games produce thousands of tile changes per tick → hundreds of KB/s per client | **Tiny (commands only)** |
| Who decides outcomes | Client majority vote | Server | **Server** |
| Validates commands before relaying | Schema only | Yes | **Yes** |
| Reconnect / late join / spectate | Re-simulate all turns (slow late in a game) | Send snapshot | **Server snapshot + turns since** |
| Desync handling | Error message | n/a | **Server resends snapshot (self-healing)** |
| Cross-browser determinism needed | Yes | No | Yes |
| Server cost | Lowest (OpenFront: one machine) | Highest (CPU + egress) | CPU per game, minimal egress |

### 7.2 Recommendation: C

- Clients send commands; the server validates them against **its own authoritative
  simulation**, stamps the sender, schedules them into a turn and broadcasts the turn.
- Every client runs the same simulation (in a worker) for smooth local rendering.
- Every N ticks clients report a hash; the server compares against **its own** hash (not
  a vote) and resyncs a diverging client with a snapshot.
- Victory, eliminations and stats come from the server's simulation.
- Reconnects, late joins and spectators receive a compressed snapshot plus later turns.
- Never trusted from clients: troop totals, gold, ownership, damage, construction,
  cooldowns, victory — clients only ever send *requests*.
- **Latency:** command → next turn boundary (~50 ms avg) + round trip ≈ 100–200 ms.
  The client shows immediate visual acknowledgement (e.g., a pending arrow at the click
  point) so it feels instant.
- **Scaling:** one game per worker thread; target < 5 ms per tick for large games →
  dozens of games per core; route by game ID across processes/machines.
- **Fallback:** if cross-engine determinism proves too costly, switch to B with
  compressed row-span deltas — the host abstraction keeps that change contained.

Phase 1 already exercises the core of this design: commands, turns, deterministic
simulation and a local turn scheduler.

---

## 8. Project structure (proposed)

```
/
├─ README.md
├─ docs/                      ARCHITECTURE · DECISIONS · GAME_DESIGN · OPENFRONT_RESEARCH · ROADMAP
├─ spikes/                    throwaway experiments & benchmarks (never imported by src/)
├─ public/                    static files served as-is (fonts, icons)
├─ src/
│  ├─ sim/                    deterministic simulation — no DOM, no deps, no randomness
│  │  ├─ rules.ts             GameRules: every tunable constant, documented
│  │  ├─ world.ts             World type + createWorld()
│  │  ├─ tick.ts              the ordered list of systems
│  │  ├─ commands.ts          command types + validation
│  │  ├─ frame.ts             what a tick reports (deltas, stats, events, hash)
│  │  ├─ map/                 GameMap, terrain, neighbors, procedural generation
│  │  ├─ systems/             spawn, attacks, encirclement, elimination, troops, victory
│  │  ├─ ai/                  bot brains (emit commands only)
│  │  └─ math/                rng.ts (seeded), detmath.ts
│  ├─ host/                   LocalHost, (WorkerHost), (NetworkHost)
│  ├─ client/
│  │  ├─ main.ts              entry point
│  │  ├─ app/                 screens & session
│  │  ├─ input/               actions from devices
│  │  ├─ camera/
│  │  ├─ render/              renderer, passes, shaders, labels, perf overlay
│  │  └─ ui/                  Svelte: hud/, screens/, tokens.css
│  ├─ shared/                 protocol types for client & server (Phase 3)
│  └─ server/                 authoritative server (Phase 3)
├─ tests/                     cross-cutting tests: determinism, banned APIs, import rules
├─ tools/                     CLI: headless balance runner, map tools
├─ index.html · package.json · tsconfig.json · vite.config.ts
```

**Dependency rules** (checked by a test that scans imports):
`sim → nothing` · `host → sim, shared` · `client → host, sim (types & pure helpers), shared` ·
`server → sim, shared` · `ui ↛ render` · `render ↛ ui` · nothing imports `spikes/`.

---

## 9. Engineering standards

- **Modules:** one system/concept per file; files over ~400 lines need a reason.
- **Names:** descriptive (`homeTroops`, `frontierSize`), no cryptic abbreviations.
- **Comments:** explain *why* (design intent, non-obvious math), not *what*.
- **Rules config:** no magic numbers in systems — use `GameRules` (e.g.
  `rules.troops.capacityBase`, `rules.combat.focusWeight`, `rules.victory.landShare`,
  `rules.ai.thinkIntervalTicks`).
- **No fake features:** placeholders are labeled as such in UI and code.
- **Errors:** the simulation rejects invalid commands silently-but-logged (they're
  normal in multiplayer); programmer errors throw.
- **Git:** commit at stable milestones with descriptive messages; checkpoint before
  large refactors.

---

## 10. Testing strategy

| Layer | What | How |
|---|---|---|
| Rules | Troop growth, capacity, costs, combat outcomes | Unit tests + **golden tests** pinning formula outputs |
| Systems | Spawn, expansion, attacks, merging/cancelling, retreat, encirclement, elimination, victory | Tiny maps written as **ASCII art** in tests (readable by anyone) — `tests/helpers/asciiMap.ts` |
| Determinism | Same seed + commands → same hash | Run twice in-process; later Node vs Chromium/Firefox/WebKit via Playwright |
| Guardrails | Banned APIs in `src/sim`, import boundaries | Tests that scan source files |
| Full games | Bots-only matches finish with a winner, no exceptions, within tick budget | Headless runner (also used for balance metrics) |
| Client | Attack % control, input mapping (click vs drag) | Component/unit tests; manual verification in the browser |
| Regressions | Every fixed bug | A test that fails before the fix |

All tests live in `tests/`, mirroring `src/` (so `src/sim` never imports a test
framework). Guard tests also test their own checkers, so a broken pattern can't silently
pass everything.

---

## 11. Performance budgets (Phase 1 reference map ~1100×700, 8 players)

| Metric | Budget |
|---|---|
| Simulation tick | < 4 ms avg, < 10 ms p99 (of a 100 ms tick) on a mid-range laptop |
| Render CPU per frame | < 4 ms; 60 fps sustained |
| GPU tile upload per tick | < 2 ms |
| HUD updates | ≤ 10/s, no layout thrash, no per-frame DOM writes |
| Memory | < 150 MB |

Later stress target: 4096×2048 map, 100 players, tick < 20 ms (in a worker).
Profile with the built-in overlay, browser performance profiles, and the headless
runner — never by guessing.
