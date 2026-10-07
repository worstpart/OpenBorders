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
- *Dev-only debug hook* (`window.__openborder`, absent from production builds): set game
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
1. applyCommands     validate & apply this turn's commands (spawn, attack, retreat,
                     alliance request/reply/renew/break, mobilize, donate)
1a. updateChat       map pings run out (milestone 2.9)
1b. updateDiplomacy  alliance requests and alliances run out (milestone 2.2)
2. resolveCollisions opposing attacks cancel; same-target attacks merge
3. advanceAttacks    each attack conquers tiles until its per-tick budget is spent
4. encircle          staggered: annex fully enclosed pockets
5. eliminate         players below the threshold are absorbed; 0 tiles → dead
                     (after encircle, so an annexed player is out in the same tick)
6. growTroops        capacity & regeneration
6b. earnGold         gold income (milestone 2.4); advanceTrade: trade ships dock and sail (2.8)
                     (2b advanceBoats and 2c advanceFlights run between steps 2 and 3 — §5.7)
7. thinkAI           bots emit commands for the NEXT tick (world.pendingCommands,
                     applied first in step 1 — same validation path as people)
8. checkVictory
9. emitFrame         tile changes, player stats, attack states, events, state hash
```

AI runs **inside** the deterministic simulation (like OpenFront), so bots cost no
network traffic and behave identically on every machine.

**Tribes & Nations (milestone 2.1).** Bots have `brain.tier` ("nation" | "tribe") and,
for nations, `brain.difficulty`. Tribe handicaps live in exactly three places: capacity
and growth (`troops.ts`, `capacityOf`), the per-tile loss of whoever attacks them
(`attacks.ts` `tileCost`, via `battle.ts` `attackLossFactor` — the same factor the HUD
and the bots use in their estimates). `PlayerSnapshot` carries `tier` and `difficulty`.
Tribes never draw a personality from the RNG, so adding tribes doesn't change the nations'
draws, and lobbies without tribes are bit-identical to Phase 1.

**Alliances (milestone 2.2, GAME_DESIGN §3.14).** `systems/diplomacy.ts` owns the state:
`world.alliances` (a Map keyed by `pairKey(a, b)`, insertion-ordered so iteration is
deterministic), `world.allianceRequests` and `world.lastRequestTick` (per ordered pair,
for the 30 s cooldown and the bots' 90 s pace; old entries are pruned), plus
`player.traitorUntilTick` / `betrayals` and `brain.grudges` — all hashed. Attack
validation rejects allies; forming an alliance retreats the armies between the two with
`attack.freeRetreat` (no penalty); the traitor discount is one more factor in
`attackLossFactor` (losses) and in `layerDelay` (speed); encirclement drops allied
enclosers; elimination drops the player's alliances. A bot's think may now emit several
commands (diplomacy, then its action — e.g. `allianceBreak` + `attack` for a betrayal).
Whether a nation betrays a given ally is decided once per alliance from a hash of
(bot, ally, formedTick), not a random draw per think. `rules.diplomacy.enabled = false`
(headless `--no-alliances`) reproduces 2.1 games exactly. Frames carry `alliances` and
`allianceRequests`; the HUD logic is in `client/app/diplomacy.ts`, and the map shows
allies/traitors through flag bits in the palette texture's alpha channel.

**Teams (milestone 2.3, GAME_DESIGN §3.15).** `Player.team` (0 = none) is fixed at setup
(`PlayerSetup.team`); `world.teamCount` is the highest team (0 = free-for-all).
`sameTeam` (world.ts) and `areFriendly` (= same team or allied, diplomacy.ts) replace the
plain alliance checks in attack validation and encirclement; alliance requests to a
teammate are rejected. `checkVictory` sums each team's land and ends the game when a
team reaches the goal or is the last side with a nation/human left (tribes don't count);
`world.winner` stays a player (the team's biggest member) and `world.winningTeam` names
the team (also on the `gameOver` event and the frame). Bots skip teammates and weigh
enemies of their teammates (`ai.teamAssistPreference`, `ai.teamFocusPreference`); with no
teams every factor is 1, so free-for-all games are unchanged. Client: `client/app/teams.ts`
(lobby split, standings), `teamPlayerColors` (players.ts), teammates share the ally flag bit.

**Economy (milestone 2.4, GAME_DESIGN §3.16).** `systems/economy.ts` owns gold:
`player.gold` (an integer, hashed) and `player.lastIncome`; `earnGold` runs as tick step
6b ("economy", right after troops) and also prunes `world.lastDonationTick` (per
`donationKey(from, to, resource)`, hashed). Two commands: `mobilize` (percent of capacity,
capped by the room under the cap and by gold) and `donate` (to an ally or teammate —
`areFriendly` — troops capped by the friend's room, or gold). Elimination calls
`lootGold`, and the `eliminated` event carries `loot`. Nations decide gold after their
action (bot.ts `economy()`: gifts, then mobilize); tribes only earn. The HUD reuses the
simulation's own `mobilizeTroops` / `donationAmount` (client/app/economy.ts). Captures with
loot animate: the client keeps a short list of effects and writes their strength into bits
2–7 of the palette alpha every animation frame (the shader's gold border and grow-in), and
the label layer draws the rising "+gold". `rules.economy.enabled = false` (headless
`--no-economy`) reproduces 2.3 games exactly.

**Timing probe (milestone 2.0).** `runTick(world, turn, probe?)` calls `probe(step)` after
each step (`TICK_STEPS`: commands, diplomacy, collisions, attacks, encircle, eliminate, troops, bots,
victory, frame). The simulation still never reads a clock; the headless runner times the
gaps between calls and reports `systemsMs` (average and worst per step) and the steps of
each game's slowest tick.

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
| `allianceRequest` | target | 2.2: asking someone who asked you accepts; 20 s expiry, 30 s cooldown per target |
| `allianceReply` | from, accept | answer an open request |
| `allianceRenew` | ally | only in the last 30 s; extended once both agreed |
| `allianceBreak` | ally | ends it now; the breaker is a traitor for 30 s |

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
| `WorkerHost` | ✅ milestone 2.8 (the game's host whenever workers exist) | A LocalHost inside a Web Worker (`host/simWorker.ts`); see below |
| `NetworkHost` | Phase 3 | Commands go to the server; turns come back; local sim in a worker |

Because the renderer and UI only ever consume `TickFrame`s, swapping hosts doesn't
touch them.

**WorkerHost as built (2.8).** The main thread keeps the map (rendering, HUD, boat
previews — its derived sea data is cached against that object) and posts the worker a copy
of its terrain and relief with the setup; the worker runs a realtime LocalHost (its own
turn timer) and posts every frame. Frames are slimmed on the way (`workerProtocol.ts`,
`FrameSlimmer`/`FrameRestorer`, round-trip tested): a boat's or trade ship's route goes
once, with the first frame that has the ship; walls only when they changed; the four
per-tick arrays are transferred, not copied. WorkerHost restores routes and walls and reuses
an unchanged ship's snapshot, so listeners get the same frames a LocalHost would give.
`paused`/`tickMs` are mirrored locally; `lastFrameTime` is the main thread's receive
time (for interpolation). Worker errors surface as the fatal-error screen. Maps are
generated in a short-lived worker too (`host/mapGeneration.ts`), falling back to the main
thread where `Worker` is missing (as LocalHost is used then). Tests and the headless
runner keep using LocalHost with a manual clock.

---

### 5.7 Buildings, ranges and flights — *2.5 buildings, 2B.0 flights, 2B.1 Airport I, 2B.2 SAMs, 2B.3 Airport II + flak built; the rest PLANNED*

Design: GAME_DESIGN §3.17; roadmap 2.5 → 2.6 → 2.7 → Phase 2B. The goal of 2.5 is that
nothing built then has to be rewritten for airports, SAMs and missiles later.

**As built in 2.5.** `rules.buildings` (types, levels, escalation, spacing; `enabled`),
`sim/geometry.ts` (the range module), `systems/buildings.ts` (`build` / `upgrade` /
`cancelBuild`, tick step 5b `updateBuildings`: captures, completions, bonuses),
`world.buildings` (ascending ids, found by binary search) + `world.buildingAt`; `setOwner`
only records tiles with a building in `world.buildingTileChanges`, which step 5b settles
once the fighting is over (a tile taken and retaken in one tick changes nothing). Each
player's `bonus` (capacity, growth, income, Mobilize discount) is summed every tick from
the buildings — derived, not hashed — and read by `troops.ts` / `economy.ts`. Nations
decide in `ai/build.ts`. Frames carry **every building every tick** (a few hundred small
objects at most — simpler than deltas; revisit if lobbies ever hold thousands). Placement
spacing is a linear scan over the buildings for now (fine at today's counts); the spatial
grid below comes with the first radius-heavy system (2.6 / 2B). Icons are drawn in
Canvas2D on the label overlay (`render/buildings.ts`); the HUD logic is
`client/app/buildings.ts` (build options, building card, click hit test).

**Definitions in one place.** `rules.buildings[type]` holds, per type: placement
(`land` / `coast` / `plains`), what happens on capture (`downgrade` / `destroy`), price
escalation, and `levels[0..2]` with `cost`, `buildTicks`, `radius`, `capacityShare`,
`charges`, `reloadTicks`, `cooldownTicks` and the effect numbers (capacity, growth,
income, loss/speed multipliers…). Changing "Airport II range" is one line. A
`rules.buildings.enabled = false` switch (headless `--no-buildings`) must reproduce 2.4
games exactly — the same regression rule as alliances and the economy.

**Data model** (all integers, hashed):

```ts
interface Building {
  id: number;              // world.nextBuildingId++, never reused
  type: BuildingType;      // "housing" | "factory" | "port" | "borderDefense" | "sam" | "silo" | "airport"
  owner: PlayerId;
  tile: number;
  level: 0 | 1 | 2 | 3;    // the level that works now (0 while first being built)
  targetLevel: 1 | 2 | 3;  // > level while constructing / upgrading
  readyTick: number;       // when the construction or upgrade completes (-1 = none)
  disabledUntilTick: number;
  charges: number[];       // reload queue (SAM interceptors, silo slots) — 2B
  cooldownUntilTick: number; // airport missions, strikes — 2B
}
```

There is **no health field**: level is health (`damageBuilding(world, b, levels, by)`
lowers the level and destroys at 0). Every place that changes a building goes through a
few choke points (`placeBuilding`, `finishConstruction`, `damageBuilding`,
`transferBuilding`), like `setOwner` for tiles, so the hash, the frame deltas, the
spatial grid and the cached per-player effects can't drift apart.

- `world.buildings: Building[]` (ordered by id) + `world.buildingAt: Int32Array` (tile →
  building id, −1) for O(1) capture checks inside `setOwner`.
- A coarse **spatial grid** (e.g. 32×32-tile cells → building ids) for every range query:
  spacing, zones, SAM coverage, Factory supply, strikes, missile blasts.
- **Per-player effects** (capacity bonus, growth bonus, income bonus, Mobilize discount)
  are recomputed only when a building of that player changes, and read by `troops.ts` and
  `economy.ts` — those systems don't know building types.

**Unified range module** (`sim/geometry.ts`, built in 2.5): `distanceSq(map, a, b)` (exact
integer), `withinRange(map, a, b, r)` (`distanceSq ≤ r²` — no square root), `distance`
(`Math.sqrt`, exactly rounded by IEEE 754), `travelTicks(distance, tilesPerTick)` and
`pointAlong(map, a, b, t)` (+ − × ÷ only). Everything that measures map distance uses it:
spacing, zones, SAM radius, airport/silo range, flight positions, the HUD's rings and
ETAs. Boats feed their water-path length into the same `travelTicks`.

**Walls (2.6, D-024 — as built).** `systems/walls.ts`. A wall is game state:
`world.walls` (ascending ids; `points`, the rasterized `tiles`, `intact`, level/targetLevel,
start/ready ticks, paid), `world.wallAt` (tile → wall id, -1) and `world.wallHash` (XOR of
`ownerTileHash(tile, wallId)` over standing tiles, maintained incrementally) — all in the
state hash. `wallTiles(map, points)` is Bresenham, 8-connected, shared with the HUD;
`wallPlan` validates (own land, no water, no building, ≤ 80 tiles, ≤ 12 points; walled
tiles are joined, not rebuilt). Commands `buildWall {points}`, `upgradeWall`,
`cancelWall`; `updateWalls` runs with the buildings (step 5b). **Breaking:** `setOwner`
calls `breakWallTile` when a wall tile changes hands — it is removed at once (events
`wallBreached`, and `wallDestroyed` when no tile is left). `world.fortLevel` (Uint8 per
tile) is the *working* wall level (0 while building), logged in `world.fortChanges` for the
frame (`fortTiles` / `fortLevels`). The attack code reads one hook per effect:
`tileCost` multiplies by `wallLossFactor` (through `attackLossFactor`, so the HUD/bot
odds use the same factor) and adds `wallBreakTroops`; `layerDelay` adds
`wallHoldTicks(tile, speed)` (= hold × max(½, √speed)). Suppression (2B) will plug into
the same functions. Frames carry `walls` snapshots (standing tiles), rebuilt only when
`world.wallsVersion` changes and otherwise shared between frames. **Client:** walls are
drawn in Canvas2D on the label overlay (`render/buildings.ts`: runs of 8-connected
standing tiles as thick lines by level, towers at run ends, dashed while building, the draft
wall with lettered points) — not in the map shader: a wall is an object on the land, and a
screen-width line would need neighbouring tiles' pixels in a shader. The first 2.6 design
(posts fortifying a zone, derived field, wall pattern on border edges in the shader, D-022)
was built, tested and replaced the same day; nothing of it remains in the code.

**Tick order additions** (ARCHITECTURE §5.3):

```
1.  applyCommands      + build, upgrade, cancelBuild, buildWall, upgradeWall, cancelWall, boat, recallBoat; (2B) airlift, assault ✅; airStrike, launchMissile
1c. advanceBuildings   constructions/upgrades finish; disabled timers and reloads run out
2b. advanceBoats       (2.7) boats that arrive land as beachhead attacks (or home); recalled boats unload
2c. advanceFlights     (2B.0 ✅ arrivals) SAM interceptions first (2B.2 ✅), Fortress Wall flak (2B.3 ✅), then
                       flights over their target arrive, with arrival effects: airlift → friend's home troops (2B.1);
                       assault → beachhead attack (2.7, 2B.3 ✅) — before step 3, like boats, so a
                       landing's first tile falls the same tick; strike/missile → damageBuilding
                       + suppression zones (2B.4/2B.5)
3.  advanceAttacks     reads the wall hooks (loss, break troops, hold; suppression in 2B)
    (setOwner)         captured tiles transfer or destroy their building; wall tiles break
6.  growTroops / 6b earnGold   read the cached per-player building effects
7.  thinkAI            + ai/build.ts (what/where/when to build and upgrade) — a separate module
```

**Flights (2B.0 — as built).** `systems/flights.ts`. `world.flights` (ascending ids;
owner, kind, source building, fromTile, toTile, target = the target tile's owner at launch,
planes, troops, launchTick, arriveTick) + `world.nextFlightId`. Positions are a pure
function of the tick: `flightProgress` = elapsed / (arrive − launch), `flightPoint` →
`geometry.pointAlong` (+ − × ÷ only), `flightTile` (rounded, for SAM checks); the
arrival tick is `launch + travelTicks(distance, speed)` (`rules.flights`: transports 2,
fighters 3, missiles 3 tiles/tick), so the square root is taken once, at launch.
`launchFlight` (callers validate the mission), `advanceFlights` (step 2c: arrivals —
2B.0's test flights do nothing; each later kind adds its effect there), `shootDown` (the one
place planes are lost: a plane takes its share of the troops; 0 planes = gone),
`loseFlightsOf` (elimination), `landAllFlights` (game over: troops in the air go home).
Troops aboard count as field troops (`updateFieldTroops`). Events `flightLaunched`,
`flightArrived`, `flightIntercepted`, `flightLost`; frames carry `flights` snapshots (made
once per flight, remade when planes are lost — no positions, the client computes them).
**Hash:** flights are hashed only once a game has had one (`nextFlightId > 1`), and a
building's charges/cooldowns only once it has used any — so games without them keep their
pre-2B hashes, which is what the seed-by-seed regression check compares. **Charges and
cooldowns** on `Building`: `reloads` (ticks when spent charges are back, ascending; they
reload one at a time; finished ones are pruned in step 5b) and `cooldowns` (end tick per
mission slot), with `readyCharges` / `spendCharge` / `cooldownLeft` / `startCooldown` in
`buildings.ts`; building snapshots carry both. **Debug:** the `testFlight {from, to}`
command (empty transports from your land to any tile) is accepted only with
`rules.flights.testFlights` — off by default, on in dev builds of the client (`client.ts`
passes `makeRules` when `import.meta.env.DEV`). Interception: see "SAMs (2B.2)" below.
**Client (2B.0):** `app/flights.ts` (`FLIGHT_INFO` per kind: icon, name, hostile;
`flightPosition`, `flightSecondsLeft`), `render/flights.ts` (`FlightLayer` on the label
canvas after boats: aircraft glyph in the owner's colour pointing along its line, "×planes",
dotted line to the target — yours light with a ring and ETA, hostile ones at your land red,
everyone else's faint), hostile flights in `threats.ts` (kind "flight": chips, threat
ring + countdown, edge arrows), a toast at launch, and the boat horn once per sender per 30 s
(`alerts.ts`). Range rings in action mode come with the first action (Airport card, 2B.1).

**Airport and airlift (2B.1 — as built).** `rules.buildings.types.airport` (placement
`plains`; level fields `range`, `liftShare`, `missionCooldownTicks`), `rules.flights.enabled`
(false = Airports and missions off, games replay 2B.0b exactly) and `airliftPlanes`. In
`systems/flights.ts`: `airliftProblem` / `airliftTroops` / `airliftCapacity` /
`airliftCooldownLeft` / `airportRange` take an `AirportLike` (a building or its snapshot), so
the HUD preview and the nations use the sim's own checks; `applyAirlift` (command `airlift
{buildingId, tile, percentBp}`) takes the troops from home, launches kind `airlift` and
starts cooldown slot 0 (`AIRLIFT_SLOT`); `advanceFlights` delivers (`deliverAirlift`: the
friend at launch takes `troopRoom`, event `airliftDelivered`, the rest launches as kind
`return` to the take-off tile → the owner's home troops). `airliftSite` (a friend's border
tile nearest the Airport, ties to the lower tile) is where nations land. AI: `bot.ts`
`economy()` picks the friend losing worst among bordered ones (gift) and, with a ready
Airport, unbordered ones in range (airlift); `build.ts` values one Airport
(`airportWorth` × capacity) only while such a friend is in need and within 9/10 of Airport
I's range of the middle of the bot's land. `FlightSnapshot.source` (the Airport, for the
era of the plane sprite). **Client:** `app/flights.ts` `airliftPreview` +
`AIRLIFT_PREVIEW_TEXT`, `ui.airliftFrom` (aiming mode; cleared when the Airport goes or the
game ends), `client.ts` `startAirlift` / `sendAirlift`, `render/flights.ts` draws the range
ring, line, landing ring and "✈ troops · s"; the building card's `airlift` field and
`laterLevel` note; toasts for `flightLaunched` (airlift to me) and `airliftDelivered`.

**SAMs (2B.2 — as built).** `rules.buildings.types.sam` (placement `land`, adopted on
capture; level fields `range` = radius, `interceptors`, `reloadTicks`); available with
`rules.flights.enabled` (off = no SAMs, games replay 2B.1 exactly). In `systems/flights.ts`,
`advanceFlights` first runs `interceptFlights`: the working SAMs (level ≥ 1; one being
upgraded fires at its old level) are listed once; each flight, in id order, is checked at
`flightTile(tick)` against them in id order — a SAM fires when its owner isn't the flight's
owner or a friend (`areFriendly`: the target's and any third player's SAMs alike), it has a
ready charge (`readyCharges`) and its radius holds the tile (`withinRange`): `spendCharge`
(reload queue), `shootDown(flight, 1, owner, samTile)`. At most one shot per SAM per tick and
one plane per interceptor (no multipliers). A plain loop, no spatial grid: flights and SAMs
are few (revisit if headless tick times say otherwise). Event `flightIntercepted` gained
`fromTile` (the SAM's tile, -1 = none). Shared helpers on `SamLike` (building or snapshot):
`samRadius`, `samInterceptors`, `samReady`, and `interceptorsOnRoute` (follows a would-be
flight tick by tick over the same `flightTile`s and sums the ready interceptors of the hostile
SAMs it meets) — used by the HUD's airlift warning and by `airliftSite`, which, when any
hostile SAM stands, checks up to 24 of the friend's border tiles in range (spread from nearest
to farthest) and lands on the one meeting the fewest interceptors (none when every route
would lose every plane). AI (`ai/build.ts`): `airDefence` — only while a non-friend's working
Airport reaches one of the bot's Housing/Factory/Airport buildings (range + `samThreatMargin`);
`samValue` = `samWorth` × capacity × interceptors × share of guarded levels covered (new SAMs:
only levels no SAM of the bot covers yet); `bestSamCenter` / `samSite` (sampled within half a
radius of the guarded building with the most uncovered levels); at most `maxSams`; upgrades
valued the same way. Headless `airPerGame` adds `sams`, `samUpgrades`, `planesShotDown`,
`troopsShotDown`. **Client:** the building card's `sam` field (ready / max interceptors,
seconds to the next, radius) and `SAM_LATER` upgrade lines (missile features marked
"Later"); `ui.airDefense` (key V, the build bar's ◎ toggle); `client.ts` `rangeRings()` →
`render/buildings.ts` `RangeRing`s under the icons (every SAM in the air defence view or while
placing a SAM, hostile ones while aiming an airlift, the SAM or Airport whose card is open;
yours light, friends' blue, others red; ready interceptors as marks on the rim); the SAM ghost's
`reach` ring; `airliftPreview` → `planesLost` / `planes` (label "⚠ SAMs: n of 4 planes shot
down"); `ShotEffect`s from `flightIntercepted` (streak `SHOT_MS`, then puff `PUFF_MS`, drawn by
`FlightLayer`); toasts for our planes lost and our SAM's hits (no sound — alerts stay rare).

**Airborne assault and flak (2B.3 — as built).** Airport level II (`Military Airport`: range
300, `liftShare` 0.15, cooldown 250 ticks); `rules.flights.assaultPlanes` (4) and
`airborneLoss` (1.25). In `systems/flights.ts`: `ASSAULT_LEVEL` (2), `assaultProblem` (same
shape as `airliftProblem`, `hostile` = the tile's owner is a living non-friend player) +
`ASSAULT_PROBLEM_TEXT`; `applyAssault` (command `assault {buildingId, tile, percentBp}`;
`naval.ts` `hostileTarget` — now exported — gives the exact reason for own / teammate / ally /
spawn-protected land; neutral land and sea are refused) takes the troops (the same
`airliftTroops` cap) and launches kind `assault`, sharing cooldown slot 0 with airlifts. On
arrival `landAssault`: own land → home troops; a hostile owner (or neutral land, if the target
died) → `launchBeachhead(…, focus = landing tile, airborneLoss, airborne = true)`; a friend's →
a `return` flight. Event `assaultLanded {flightId, owner, target, tile, troops, attackId}`.
`Attack.airborne` (hashed only when true, so games without assaults keep their hashes;
`attackStarted.airborne` and `AttackSnapshot.airborne` carry it to the HUD). **Flak:**
`WallLevelRules.flakRadius` (Fortress Wall: 3). `flakFlights` runs after `interceptFlights`,
only while some wall has a flak level: for each flight (id order) the hostile flak walls whose
reach holds `flightTile(tick)` but not `flightTile(tick − 1)` fire once each (id order) —
stateless, no per-flight memory; the scan is the (2r+1)² tiles around the flight on
`fortLevel` / `wallAt` / `owner`. `shootDown` gained `weapon` ("sam" | "flak"), carried by
`flightIntercepted`. **AI:** `assaultSite` (the target's heart if held and in range, else —
for a non-neighbour — the quietest border tile in range) shares `quietSite` with
`airliftSite` (same candidates and order as 2B.2, so airlifts land exactly as before);
`bot.ts` `chooseAirTarget` (ready Military Airport; non-tribe enemies it doesn't border or
whose front is walled; the land estimate with `airborneLoss`, the lift cap and the planes the
route's SAMs would down; `airPreference`) competes with `chooseTarget` by `score` (new on
`Choice`), boats last; assaults count as strikes for Mobilize and pings. `build.ts`
`assaultProspect` (an air-reachable enemy weak enough that one Military Airport lift would
take the personality's `minLandGain`) and `assaultValue` (`assaultWorth` × capacity, split
over levels I–II by price). Headless `airPerGame` adds `airportUpgrades`, `assaults`,
`assaultTroops`, `assaultsLanded`, `assaultTiles`, `flakShots`. **Client:** `LiftMode`
("airlift" | "assault") in `ui.liftMode`; `airliftPreview(…, mode)` and `liftProblemText`;
`startAirlift(id, mode)`; the card's `airlift.assault` → "🪂 Airborne assault" button;
`flightSprite` (helicopters for assaults); toasts for `assaultLanded`, airborne
`attackStarted` and flak hits; attack chips show 🪂 for airborne armies.

**Beachhead attacks (2.7).** Today a player may run armies against several enemies at once
(one per enemy, like OpenFront); a second land click on the *same* enemy adds to that army
(`launchAttack` finds it by attacker + target), and every front starts from the attacker's
border. Boats (2.7) and airborne assaults (2B.3) need an army whose front starts at a
**landing tile** and that does **not** merge with the land army against the same enemy
(OpenFront's boat attacks don't merge either). So the merge lookup gains a "source" (land
or a landing) and fronts can be seeded from a landing tile — the main structural change of
the plan, done once in 2.7 and reused by 2B. Land attacks are unchanged. Landing pockets are protected from encirclement while their attack advances.

*As built (2.7):* `Attack` gained `landingTile` (-1 for land armies) and `lossFactor`
(Marines 0.8; airborne 1.25 since 2B.3, which also added `airborne`). `launchBeachhead(world, player, target, landingTile,
focusTile, troops, lossFactor)` in `systems/attacks.ts` creates one: its front holds only
the landing tile, ready at once; `advance` lets that one tile be taken without touching the
attacker's land, and everything after spreads by the normal `discover`. `applyAttackCommand`
merges only into armies with `landingTile < 0`. `encirclement.ts` treats the piece holding
the landing tile of an advancing beachhead as safe; ending or retreating a beachhead marks
the attacker `encircleDirty` so the pocket is checked again.

**Boats (2.7, `systems/naval.ts`).** `world.boats` (ascending ids; owner, target, troops,
launch/landing/focus tiles, `route: Int32Array` of sea tiles, launchTick, tilesPerTick,
lossFactor, arriveTick, recallTick) — hashed, never moved tick by tick: `boatProgress(boat,
tick)` is a pure function of the tick (recalled boats sail back from where they turned).
Static per-map data is derived once and cached in WeakMaps keyed by the map (not game state):
`seasOf` (4-connected water bodies), `landmassesOf`, `coastTiles`. `planBoat(rules, map,
owner, buildings, playerId, ownTiles, target, tile)` is shared by the simulation and the HUD
(preview = what a click does): landing = `nearestCoast` of the target around the click;
launch = the player's coast tile on the same sea with the best straight-line ETA (nearest,
or a Port tile); `seaRoute` = integer A* (10/14, octile heuristic, no corner cutting) over
water with a node budget and per-map scratch arrays, ties popped in insertion order
(`TileQueue`) — deterministic. Field troops include boat troops (`updateFieldTroops`).
Elimination sinks the owner's boats; game over unloads them. Frames carry `boats`
snapshots, made once per boat (the route copied once) and remade only on recall. The client
draws boats, routes and the click preview on the Canvas2D overlay (`render/boats.ts`); HUD
logic in `client/app/boats.ts` (chips, preview, `needsBoat`: a click on land whose owner
we don't border, or on a landmass where we own nothing, sends a boat).

**Trade ships (2.8, `systems/trade.ts`, D-026).** `world.tradeShips` (ascending ids; owner,
fromPort/toPort building ids, launch/landing tiles, route, launchTick, tilesPerTick,
arriveTick, gold) — hashed, positions a pure function of the tick like boats (the client's
`boatPosition` takes any `Voyage`). `advanceTrade` runs in step 6b right after `earnGold`:
ships that arrive dock (the destination Port's *current* owner receives; none if the Port is
gone or now the sender's own), then every finished Port whose beat comes up (`(tick + id·37)
mod tradeEveryTicks`) sends a ship to a random partner Port (`tradePartners`: other living
players' finished Ports sharing a sea) using `world.rng`. Port-to-Port routes are cached per
map (static). `owner`/`toPort` are mutable so warships can capture ships (2B.6). Events:
`tradeDocked`; frames carry `tradeShips` snapshots (made once per ship); players carry
`tradeGold`. Nations value a Port's trade with `expectedTradePerTick` (straight-line
distances, no searches).

**Frames and rendering.** Frames carry building deltas (added/changed/removed: id, type,
owner, tile, level, targetLevel, readyTick, disabled) and flight launch/interception/
arrival events — never per-tick positions. The renderer draws building icons (level
drawings + pips) as instanced quads in WebGL (hundreds of icons in 126-player lobbies;
the Canvas2D label layer would be the fallback for a first version), range rings and
routes as an overlay pass; walls on the Canvas2D overlay (2.6).

**Multiplayer (Phase 3).** Nothing new is needed in the protocol: these are commands, and
under D-006 the server runs the same simulation, so construction, upgrades, damage,
interception, transported troops and captures are computed server-side and checked by the
state hash. Snapshots must include buildings, walls and flights; `wallAt` and
`fortLevel` are rebuilt from the walls.

## 6. Client architecture

| Module | Responsibility | Must not |
|---|---|---|
| `app/` | Screens (menu → game → results), session lifecycle, wiring host ↔ renderer ↔ UI | Contain game rules |
| `input/` | Pointer/keyboard/touch → semantic actions (click vs drag threshold, wheel, pinch, keymap) | Know about rendering or rules |
| `camera/` | Position/zoom state, smooth zoom-to-cursor, bounds, focus animations | — |
| `render/` | WebGL2 passes, shaders, textures, labels, perf overlay | Read simulation internals |
| `ui/` | Svelte components (HUD, menus), design tokens, stores updated from frames | Mutate game state (only dispatch actions) |
| `audio/` | Alert sounds (2.9): `sound.ts` synthesizes four alerts with Web Audio, throttles them, keeps volume/mute in localStorage | Decide *when* to alert (the client does, from events and the threat list) |

UI stores update at most once per tick; anything faster (smooth bars, counters) is done
with CSS/Svelte tweens, not more updates. No per-frame DOM writes.

**As built (milestone 1.6).** `app/uiState.svelte.ts` is the one reactive store; `client.ts`
writes it from tick frames and owns every action (attack a tile, retreat, counter, pause,
speed). Components only read it and call actions (exception: the attack % and
leaderboard collapse are pure UI choices). The only per-frame write is the hover card's
cursor position, and only when the mouse actually moves to another pixel. HUD logic lives
in plain, unit-tested modules next to the store — `troopBar.ts` (sweet-spot model),
`preview.ts` (what a click would do; mirrors the sim's checks), `toasts.ts` (which events
become toasts), `hints.ts` (contextual hint order, finished hints kept in localStorage),
`focus.ts` (aim a counter-attack) — so the Svelte files stay presentational. Battle odds
come from `sim/battle.ts`, the same estimate the bots use. Tick frames carry each human
player's land neighbours (`PlayerSnapshot.neighbors`, null for bots to save work) so the
HUD knows what a click can reach. While a menu is open, `input/controls.ts` passes only
Escape to the game, so Tab / Enter / Space / arrows work on the menu's buttons.

**Alerts, pings & emojis (milestone 2.9, GAME_DESIGN §3.20).** Sim: `systems/chat.ts`
(`emote` / `ping` commands, `world.pings`, `Player.lastEmoteTick/lastPingTick` — all
hashed; events `emoted`, `pinged`; frames carry `pings`), `ai/chat.ts` (`pingIntel` feeds
`chooseTarget`/`chooseSeaTarget`; `nationPing` after a nation's actions; `nationChatter`
at the start of `thinkBots`, reacting to the tick's events — RNG drawn only when a person is
involved, so bots-only games keep their random sequence). Client: `app/threats.ts` (the
incoming-threat list — boats now; 2B adds kinds), `app/chat.ts` (visible pings, emoji
bubbles, the G key's ping kind), `render/markers.ts` (ping rings, threat rings, edge
arrows, emoji bubbles on the label canvas, drawn last), `audio/sound.ts`. `client.ts`
plays the cues `app/alerts.ts` (`AlertPlanner`: attackers once per 30 s, new boats, alliance
asks and new renewal cards, any betrayal) picks each tick. Dev hook:
`__openborder.sound()` returns the audio state and the cues played (the pane can't be heard).

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
│  │  ├─ battle.ts            battle estimates shared by bots and the HUD's odds labels
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

**Milestone 2.8 (Huge map 2200×1400, 126 players, in a worker):** headless, 2 games at a
time: tick 2.8 ms avg, p99 18 ms; the worst ticks are each game's one-time sea data (~80 ms,
first bot think) and a first-time trade route (~40 ms, then cached). Browser at 4×: 165 fps,
1.5 ms CPU per frame — the main thread no longer waits for ticks. Sea routes got a coarse
guide for big maps (`naval.ts`: 8×8-tile blocks, a cached block-distance field per
destination as the A* estimate, and an exact same-sea check first): on Huge, route searches
went from median 9.9 / p95 162 / max 218 ms to 3.6 / 17.6 / 25 ms.

**Milestone 2.0 (126 players), measured with the headless runner, game alone:** reference
map tick 0.8–1.1 ms avg, p99 ≤ 4.2 ms — within budget. Large map (1560×990): 1.4–1.7 ms avg,
p99 10.2–10.7 ms, max ~20 ms, the spikes from encirclement floods of 500k-tile territories.
Browser: 0.5–1.3 ms CPU per frame. `WorkerHost` stays deferred to 2.7 (bigger maps), together
with cheaper encirclement for huge territories (e.g. flood only when a player *lost* land
or a neighbour changed, or track pieces incrementally).
Profile with the built-in overlay, browser performance profiles, and the headless
runner — never by guessing.
