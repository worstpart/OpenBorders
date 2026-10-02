# OpenFront Research — Technical Reference

> **What this is.** A study of how OpenFront works internally, written to be our
> technical reference while we design and build our own game.
>
> **Version studied.** OpenFront repository `openfrontio/OpenFrontIO` at commit
> `e02eeba` (2026-10-01), live game **v0.34.21** at <https://openfront.io/>.
>
> **Method.** We read the actual source (≈188,000 lines of TypeScript), traced each
> system end to end, then cross-checked numbers against the live game (single-player
> session) and the community wiki (<https://openfront.wiki/>). Where sources disagree,
> **the source code wins** (example: their own `CLAUDE.md` still says the renderer is
> Pixi.js — the code shows a hand-written WebGL2 renderer and Pixi is not a dependency).
>
> **Clean-room note.** This document describes behavior in our own words. Formulas are
> written in our own mathematical notation. No OpenFront code, shaders, text or assets
> are copied into our project. File paths and function names are given only as
> references so findings can be re-verified. See §1 for licensing.

---

## Contents

- [0. The short version — why OpenFront works](#0-the-short-version--why-openfront-works)
- [1. Licensing](#1-licensing)
- [2. Architecture overview](#2-architecture-overview)
- [3. Systems](#3-systems)
  - Foundations: [3.1 Simulation & ticks](#31-deterministic-simulation--tick-system) · [3.2 Map representation](#32-map-representation) · [3.3 Map loading & generation](#33-map-loading--generation)
  - Core loop: [3.4 Players](#34-players--player-types) · [3.5 Spawning](#35-spawning--the-spawn-phase) · [3.6 Territory & borders](#36-territory-ownership--borders) · [3.7 Troops](#37-troops-generation--capacity) · [3.8 Neutral expansion](#38-neutral-expansion) · [3.9 Combat](#39-combat-attack-resolution) · [3.10 Encirclement](#310-encirclement--annexation) · [3.11 Elimination](#311-elimination) · [3.12 Victory & anti-stall](#312-win-conditions--anti-stall)
  - Economy: [3.13 Gold](#313-gold-economy) · [3.14 Buildings](#314-buildings--construction)
  - Naval: [3.15 Transport ships](#315-transport-ships-naval-invasion) · [3.16 Trade ships](#316-trade-ships--ports) · [3.17 Warships](#317-warships--naval-combat)
  - Strategic: [3.18 Nukes & SAMs](#318-nuclear-weapons--sams)
  - Diplomacy: [3.19 Alliances](#319-alliances-betrayal--relations) · [3.20 Sharing & communication](#320-resource-sharing--communication)
  - AI: [3.21 Tribes (bots)](#321-tribes-filler-bots) · [3.22 Nations](#322-nations-smart-ai)
  - Multiplayer: [3.23 Protocol](#323-networking-protocol) · [3.24 Server](#324-server-architecture--scaling) · [3.25 Sync & anti-cheat](#325-synchronization-desync-detection--anti-cheat) · [3.26 Reconnects & spectators](#326-reconnects-late-joins--spectators) · [3.27 Lobbies & modes](#327-lobbies-matchmaking--game-modes) · [3.28 Single-player, replays, snapshots](#328-single-player-replays--snapshots)
  - Client: [3.29 Client threading](#329-client-architecture--threading) · [3.30 Rendering](#330-rendering) · [3.31 Camera & input](#331-camera--input) · [3.32 UI/UX & HUD](#332-uiux--hud) · [3.33 Sound](#333-sound--events) · [3.34 Settings](#334-settings--persistence) · [3.35 Performance techniques](#335-performance-techniques) · [3.36 Mobile](#336-mobile-controls)
- [4. How the systems interact](#4-how-the-systems-interact)
- [5. Direct answers to our research questions](#5-direct-answers-to-our-research-questions)
- [6. Known exploits & weaknesses](#6-known-exploits--weaknesses)
- [7. Preserve vs. redesign](#7-preserve-vs-redesign)
- [8. Glossary](#8-glossary)

---

## 0. The short version — why OpenFront works

1. **One resource drives everything early: troops.** Troops are simultaneously your
   army, your defense, and your "currency" for expansion. There are no units to
   micromanage — you commit a *percentage* of your troops and the simulation does
   the rest.
2. **Growth peaks in the middle.** Troop regeneration is fastest at roughly **40% of
   your maximum** and falls to zero at the cap. Sitting at max wastes growth;
   spending down to the sweet spot is free. This single curve creates the constant
   "attack now or keep growing?" question.
3. **Land raises the cap, sublinearly.** Max troops grow with territory^0.6, so land
   matters but doubling your land only gives ~1.5× capacity. Bigger empires also
   refill *proportionally* slower — a built-in brake on snowballing.
4. **Defense is global.** A defender's entire troop pool defends every border. Every
   tile lost costs the defender their *average troops per tile*. So a player fighting
   one war is weaker on every other border — opportunism is naturally rewarded.
5. **Attacks are cheap per tile when overwhelming, expensive when outnumbered.**
   Attacker losses scale with (defender troops ÷ attacking troops), clamped. Speed
   scales with the *width* of the front.
6. **Geometry matters.** Fully surrounded pockets are annexed instantly; wide fronts
   attack faster; mountains are slower and bloodier; coasts can't be encircled.
7. **Deterministic lockstep.** The server never simulates. It relays player *intents*
   every 100 ms; every client runs the identical simulation. Server costs are tiny
   (the whole game runs on **one machine**), bandwidth is tiny, and cheating by
   editing local state only desyncs the cheater.
8. **The GPU draws the map.** Tile ownership lives in a 16-bit GPU texture. A shader
   colors tiles and finds borders. Only changed rows are re-uploaded, and changes are
   "dripped" over several frames so 10 Hz simulation looks smooth at 60 fps.
9. **AI uses the same actions as humans.** Bots issue the same attack commands.
   Difficulty comes mostly from reaction time and strategy ordering (plus explicit
   troop multipliers at higher difficulties).
10. **Zero friction to start.** Open the site → anonymous name pre-filled → "Solo" or a
    public lobby already counting down. No account required.

---

## 1. Licensing

### 1.1 What the files say

| Scope | License | Source |
|---|---|---|
| All code since 2025-09-04 | **AGPL-3.0** with Section 7 additional terms | `LICENSE`, `LICENSING.md` |
| Code 2025-03-25 → 2025-09-04 | GPL-3.0 for `src/client`, MIT elsewhere | `LICENSING.md` |
| Code before 2025-03-25 (commit `25d5cc37`) | MIT (whole project) | `LICENSING.md` |
| Assets in `/resources` (maps, sprites, sounds, fonts…) | **CC BY-SA 4.0**, attribution "OpenFront" / "OpenFront Inc." | `LICENSE-ASSETS` |
| Assets in `/proprietary` (logo, OpenFront font, music & sound effects, favicon) | **All rights reserved** — not usable outside OpenFront | `proprietary/LICENSE` |
| Anything on their CDN/servers/database (premium skins, etc.) | Proprietary | `LICENSING.md` |
| Their API (auth, stats, cosmetics, payments) | Closed source, not in repo | `CLAUDE.md` |

**AGPL Section 7 additional terms** (end of `LICENSE`):
- **7(b) Attribution:** modified versions must keep the notice **"© OpenFront and
  Contributors"** in reasonably visible places (footer, loading screen, splash, or menu).
- **7(c) No misrepresentation:** modified versions may not use "OpenFront" as their
  primary title or imply an official relationship.

They also use "OpenFront™" as a trademark on the site.

### 1.2 What obligations would apply to us

*This is an engineer's reading, not legal advice. For anything commercial, a short
consultation with a lawyer is worth it.*

**Option A — Independent implementation inspired by the mechanics (recommended).**
- Copyright protects *expression* (code, art, text), not game *ideas, rules or
  mechanics*. We may implement "troops grow fastest at mid-capacity" or "surrounded
  land is annexed" in our own code.
- Obligations: don't copy their code, shaders, UI text, art, sounds, maps or fonts;
  don't use the OpenFront name, logo or confusingly similar branding.
- Discipline we'll follow: write code from **our** design docs (not by translating
  their files), use **our own constants and tuning**, keep this research doc as prose
  and math, never paste their source.
- We may still *choose* to use their CC BY-SA maps later (attribution + our modified
  map files must also be CC BY-SA). That does not force our code to be open.
- We keep full freedom over our license and business model.

**Option B — Derivative / fork that complies with AGPL-3.0.**
- Our **entire** game (client and server) becomes AGPL-3.0.
- **Network clause (§13):** everyone who plays our hosted version must be offered the
  complete source of exactly what we run (e.g., a visible "Source" link), including
  server changes.
- Keep "© OpenFront and Contributors" visible; can't be called OpenFront; keep
  copyright headers; state our changes.
- Their CC BY-SA assets are usable with attribution + share-alike; `/proprietary`
  assets are not usable at all, so we'd still need our own logo, font and sounds.
- Anyone can legally take our code too. Monetization is still possible, but closed
  server-side advantages are not.
- Practical cost: inheriting 188k lines including Steam, cosmetics, payments, ranked,
  telemetry and their closed API integration — most of it irrelevant to our vision.

**Option C — Fork the MIT-era code (before 2025-03-25).** Legally the most permissive
way to reuse actual code (keep the MIT notice), but that code is ~18 months older,
predates the WebGL renderer and most current systems, and is still a codebase we'd
have to understand and then largely rewrite. Not recommended.

**Recommendation: Option A.** It matches your goals (our own polished presentation,
clean architecture sized for us, freedom over licensing) and loses nothing we need:
what's valuable in OpenFront is the *design knowledge*, which this document captures.
**Status: awaiting your decision** (see `DECISIONS.md` D-001).

---

## 2. Architecture overview

```
┌──────────────────────────── Browser (each player) ─────────────────────────────┐
│  Main thread                                    Web Worker                     │
│  ┌──────────────┐  intents   ┌────────────┐    ┌──────────────────────────┐    │
│  │ Input / HUD  │──────────▶ │ Transport  │    │  Core simulation         │    │
│  │ (Lit + TW)   │            │ (WebSocket │    │  (pure TS, deterministic)│    │
│  └──────▲───────┘            │  or Local- │    │  GameRunner → GameImpl   │    │
│         │                    │  Server)   │    │  Executions mutate state │    │
│  ┌──────┴───────┐            └─────┬──────┘    └────────▲────────┬────────┘    │
│  │ GameView     │◀── GameUpdates ──┼────────────────────┼────────┘             │
│  │ (mirror)     │   (packed typed  │   turns ───────────┘                      │
│  └──────┬───────┘    arrays,       │                                           │
│  ┌──────▼───────┐    transferred)  │                                           │
│  │ WebGL2       │                  │                                           │
│  │ renderer     │                  │                                           │
│  └──────────────┘                  │                                           │
└────────────────────────────────────┼───────────────────────────────────────────┘
                                     │ WebSocket (binary "zbin" frames)
┌────────────────────────────────────▼───────────────────────────────────────────┐
│ Game server (Node.js, Express, ws) — NO simulation                              │
│  • stamps clientID onto each intent, validates schema, rate-limits             │
│  • every 100 ms bundles intents into a numbered Turn and broadcasts it         │
│  • compares client state hashes (desync detection), tallies winner votes       │
│  • lobbies, matchmaking hooks, archives finished games                         │
└────────────────────────────────────┬───────────────────────────────────────────┘
                                     │ HTTPS
                      ┌──────────────▼──────────────┐
                      │ Closed-source API (Cloudflare│
                      │ Worker): auth, stats, store) │
                      └─────────────────────────────┘
```

| Layer | OpenFront choice |
|---|---|
| Language | TypeScript everywhere (core shared by client and server) |
| Build | Vite |
| Simulation | `src/core` — pure TS, no dependencies, deterministic, runs in a Web Worker |
| Rendering | Custom WebGL2 renderer, ~30 passes, GLSL shaders (`src/client/render/gl`) |
| UI | Lit web components + Tailwind CSS 4 |
| Audio | Howler.js |
| Validation | Zod schemas for every message; custom binary encoding ("zbin") on the wire |
| Server | Node.js `cluster` (1 master + N workers), Express, `ws` |
| Tests | Vitest; tiny test maps; "golden" tests that pin formula outputs |
| Maps | Go tool converts grayscale PNG → binary terrain + manifest |

---

## 3. Systems

> Convention: unless stated otherwise, **all gameplay logic runs in the deterministic
> core on every client**, and the server's only gameplay responsibility is to stamp,
> validate, order and relay intents. "Server responsibilities" below therefore lists
> only anything extra.

### 3.1 Deterministic simulation & tick system

**Purpose.** Advance the world in fixed steps so every client computes identical state
from identical inputs.

**Player-facing behavior.** Invisible; the game runs at 10 simulation ticks per second.
Single-player supports pause and speed-up (0.5×, 1×, 2×, max).

**Source.** `src/core/GameRunner.ts`, `src/core/game/GameImpl.ts` (`executeNextTick`),
`src/core/execution/ExecutionManager.ts` (class `Executor`), `src/core/PseudoRandom.ts`,
`src/core/DetMath.ts`, `src/core/Schemas.ts` (`TurnSchema`).

**Key concepts.**
- **Intent** — a player's request (attack, spawn, build…), sent to the server.
- **Turn** — the server's numbered bundle of all intents received during one 100 ms
  window, each stamped with the sender's `clientID`.
- **Execution** — an object created from an intent (or by the game itself) with
  `init()`, `tick()`, `isActive()`, `activeDuringSpawnPhase()`. **Executions are the
  only thing allowed to mutate game state.** Long-running behaviors (an attack, a
  boat, a bot's brain, a player's per-tick upkeep) are executions that stay active
  across many ticks.

**Tick order (per turn).**
1. Convert the turn's intents to executions (unknown sender → no-op).
2. `tick()` every active execution, in insertion order.
3. `init()` executions added this tick (so a new attack starts conquering next tick).
4. Remove inactive executions.
5. Build per-player updates; every 10 ticks emit a **state hash**.
6. Drain packed buffers (tile changes, unit motion, player stats) for the client.

**Determinism techniques.**
- Seeded PRNG (`sfc32` with splitmix32 seeding); seeds derived from game ID and
  player IDs so each subsystem has its own stream.
- **No `Math.exp/log/pow/atan2` in simulation** — engines may differ in the last bit.
  `DetMath.ts` reimplements them with only `+ − × ÷` and bit manipulation (IEEE 754
  requires those to be correctly rounded, so all engines agree).
- Troops/gold stored as integers (`toInt`), gold as `BigInt`.
- Neighbor iteration order fixed (N, S, W, E); ordered containers; stable sorts.
- `performance.now()` is used only for metrics, never for game logic.

**Constants.** `msPerTick = 100` (10 ticks/s); hash every 10 ticks.

**Client responsibilities.** Run the core in a worker; forward turns in order; send
hashes to the server.

**Observations.**
- The `Execution` pattern is simple and flexible but spreads rules across ~60 classes;
  the order of executions is part of the rules (insertion order).
- Determinism is enforced by convention and review, plus tests (`DetMath.test.ts`).

**Reproduce.** Fixed 10 Hz tick; intents → turns → deterministic sim; seeded PRNG;
deterministic math; state hashes.

**Improve / change.** Organize rules as explicit *systems* run in a documented order
(commands → combat → growth → encirclement → victory) instead of an ordered bag of
executions; enforce banned APIs in the simulation folder automatically (a test that
fails on `Math.random`, `Math.pow`, `Date.now`, etc.).

---

### 3.2 Map representation

**Purpose.** Store terrain and ownership for millions of tiles compactly and fast.

**Source.** `src/core/game/GameMap.ts` (`GameMapImpl`).

**Layout.**
- `TileRef` = integer index `y × width + x`. Coordinates derived arithmetically.
- **Terrain** — `Uint8Array`, 1 byte per tile, immutable except water nukes:
  - bit 7 = land, bit 6 = shoreline, bit 5 = ocean (vs. lake), bits 0–4 = magnitude.
  - Land magnitude: **< 10 Plains, 10–19 Highland, 20–30 Mountain, 31 = Impassable**.
  - Water magnitude = distance to land (used for rendering depth).
- **State** — `Uint16Array`, 2 bytes per tile, mutable:
  - bits 0–11 = owner `smallID` (0 = unowned/"Terra Nullius", max 4095 players),
    bit 13 = fallout, bit 14 = defense-post coverage, bit 15 reserved.
- **Neighbors** are **4-connected** (N, S, W, E) for territory and combat; 8-connected
  only for clustering and visuals.
- A **minimap** (¼ scale) is kept for coarse pathfinding.

**Client responsibilities.** The client keeps a mirror of the state array; the
renderer uploads it directly to an `R16UI` texture.

**Observations.** 3 bytes/tile → an 8M-tile map is ~24 MB of core state. No per-tile
objects anywhere. This is the foundation of their performance.

**Reproduce.** Flat typed arrays, integer tile refs, 4-connectivity, packed bits.

**Improve / change.** Keep it. Possibly store ownership as a separate `Uint16Array`
and flags in a separate `Uint8Array` so the GPU texture is exactly the owner array.

---

### 3.3 Map loading & generation

**Purpose.** Turn artwork into playable maps.

**Source.** `map-generator/` (Go), `src/core/game/TerrainMapLoader.ts`,
`resources/maps/<name>/` (`manifest.json`, `map.bin`, `map4x.bin`, `map16x.bin`,
`thumbnail.webp`), `src/core/game/Maps.gen.ts` (generated list of 132 maps).

**Pipeline.** A PNG is read by its **blue channel**: blue = 106 or transparent → water;
pure black → impassable; otherwise blue 140–200 maps to elevation magnitude 0–30
(clamped). Islands < 30 tiles and lakes < 200 tiles are removed; the largest water body
becomes "ocean". Outputs full, ¼ and 1/16 resolution binaries plus a manifest with land
tile counts. `info.json` defines the map's nations (name, spawn coordinates, flag),
categories, playlist frequencies and optional decorative PNG layers.

**Sizes (examples).** World 2000×1000 (2.0M tiles, 652k land) · Europe 2904×1672 (4.9M
tiles, 2.35M land) · Giant World 4108×1948 (8.0M tiles, 2.34M land).

**Observations.** Real-world geography is a big part of OpenFront's appeal (nations are
real countries with flags). Maps are CC BY-SA 4.0; source imagery licensing is tracked
in `CREDITS.md`.

**Reproduce.** Image → binary terrain pipeline with elevation classes; minimaps for
pathfinding; manifest with land counts.

**Improve / change.** For our first map we can generate terrain procedurally (seeded
noise) to avoid licensing work; later build our own pipeline from public-domain data
(e.g., Natural Earth) for real-world maps.

---

### 3.4 Players & player types

**Source.** `src/core/game/Game.ts` (`PlayerType`, `PlayerInfo`), `PlayerImpl.ts`.

| Type | What it is | Strength modifiers (vs. human) |
|---|---|---|
| **Human** | A connected player | — |
| **Bot ("Tribe")** | Filler AI, many per game (solo default: 400) | max troops ÷3, growth ×0.5, starts 10k troops, gold 50/tick, attacks with troops/20, can't build (deletes captured structures) |
| **Nation** | Smarter AI tied to a map-defined country | by difficulty: start troops 12.5k/18.75k/25k/31.25k, max troops ×0.5/0.75/1/1.25, growth ×0.9/0.95/1/1.05 |

Each player has a string `id` and a compact `smallID` (the number stored in tile state).

**Observations.** Bots are deliberately weak "food" that fill empty land; nations
provide the real opposition in solo play. Humans/nations attacking bots also pay only
0.7× losses. Note that "Impossible" nations *do* get resource bonuses.

**Improve / change.** Fewer, better opponents in our MVP; no resource bonuses for AI.

---

### 3.5 Spawning & the spawn phase

**Source.** `src/core/execution/SpawnExecution.ts`, `SpawnTimerExecution.ts`,
`execution/Util.ts` (`getSpawnTiles`), `Config.numSpawnPhaseTurns`.

**Behavior.**
- Game starts in a **spawn phase**. Players click unowned land to place (and may
  re-place) their start. Each click sends a spawn intent.
- Spawn claims a **disc of radius 4** around the chosen tile (~50 tiles); if any tile
  is invalid when placing randomly, another location is tried.
- Spawn phase length: **100 ticks single-player** (but ends immediately when the human
  picks), **200 ticks multiplayer**, **150 with random spawn**. Nations spawn at their
  map coordinates; bots spawn randomly.
- Random spawns keep **≥ 30 tiles** (Manhattan) from other spawns (relaxed after 750
  failed tries).
- **Spawn immunity:** humans can't be attacked by humans for **5 s** after the phase
  (configurable); nations have their own 5 s window.
- Security: a client spawn intent is honored only if it was *issued during* the spawn
  phase; tile refs are validated.

**Interactions.** Only executions marked `activeDuringSpawnPhase` run; attacks don't.

**Improve / change.** Show good spawn suggestions (distance from others, land
quality); keep the instant start in single-player.

---

### 3.6 Territory ownership & borders

**Source.** `GameImpl.conquer / relinquish / updateBorders`, `PlayerImpl` (`_tiles`,
`_borderTiles` as `TileSet`), `GameMap.isBorder`.

**Behavior.** A tile changes owner only via `conquer` or `relinquish`. On every change:
update both players' tile sets, recompute the border status of the tile and its 4
neighbors (a tile is a border tile if any neighbor has a different owner — including
water/unowned), clear fallout, bump a `territoryVersion` counter (used to cache
expensive queries), and record a packed `(tile, newState)` update for the client.

**Observations.** Border sets are maintained incrementally (O(1) per change), which
makes "attack the whole shared border" cheap. Players are "alive" while they own ≥ 1
tile.

**Reproduce.** Incremental border tracking; tile change log per tick.

---

### 3.7 Troops: generation & capacity

**Source.** `Config.maxTroops`, `Config.troopIncreaseRate`, `Config.startManpower`,
`PlayerExecution.tick`, `client/Utils.renderTroops`.

**Formulas** (internal units; T = current troops, L = tiles owned, C = sum of completed
city levels):

```
Max troops   M = 2 · (1000 · L^0.6 + 50,000) + 250,000 · C          (humans)
Growth/tick  g = (10 + T^0.73 / 4) · (1 − T/M)                       (humans)
             then capped so T never exceeds M
Start troops   25,000 (humans)
```

**The UI divides troops by 10.** `renderTroops(x) = x / 10`. So "2.5K troops" on
screen is 25,000 internally. Verified live: at spawn the HUD showed `3.45K / 12.1K`
and `+374/s`, which matches M ≈ 120,900 and g ≈ 375/tick (×10 ticks ÷ 10 display).

**Derived insights (our analysis).**
- **Sweet spot:** for large T, g peaks where `0.73·(1 − x) = x`, i.e. **x = T/M ≈ 0.42**.
  Above ~42% of max, spending troops *increases* regeneration.
- **Capacity scaling:** M ∝ L^0.6 → 10× land ≈ 4× capacity.
- **Growth scaling:** peak growth ∝ M^0.73 ∝ L^0.44 → 100× land ≈ 7.6× growth.
- **Refill time** ∝ M / g_peak ∝ M^0.27: an empire with 100k tiles refills ~2× slower
  (proportionally) than one with 1k tiles. A gentle anti-snowball brake.
- Example capacities (internal): 1 tile ≈ 102k · 1k tiles ≈ 226k · 10k tiles ≈ 602k ·
  100k tiles ≈ 2.1M. One level-1 city adds 250k — doubling a 1k-tile player's cap.

**Interactions.** Territory → M → growth → attacks → territory. Cities convert gold
into capacity. Troops committed to attacks/boats are *not* counted toward M (see §6).

**Reproduce.** Mid-capacity growth peak; sublinear capacity; cities (or equivalent)
as a gold→capacity converter.

**Improve / change.** Show real numbers (no hidden ÷10); show the sweet spot on the
troop bar; count troops in the field toward the cap to remove stockpiling exploits.

---

### 3.8 Neutral expansion

**Source.** `Config.attackLogic` (terra nullius branch), `AttackExecution`,
`PlayerImpl.canAttack`.

**Behavior.** Expanding into unowned land is an attack whose target is "Terra Nullius".
Clicking any unowned tile connected (within 200 tiles through unowned land) to your
border launches it; it expands along **your entire border with neutral land**, in all
directions at once. Repeated clicks add troops.

**Formulas.**
```
Attacker loss per tile  = mag / 5          (bots: mag / 10)
  where mag = 80 plains, 100 highland, 120 mountain   →  16 / 20 / 24 troops
Tile cost (time)        = clamp(2000 · tileCost / attackTroops, 5, 100)
  where tileCost = 16.5 plains, 20 highland, 25 mountain
Per-tick budget          = 2 · frontier tiles
```
So with more than ~6,600 troops in the attack, neutral expansion proceeds at its
maximum speed: about **0.4 × frontier tiles per tick** (~4 tiles of depth per second).
A small attack (a few hundred troops) crawls.

**Observations.** Early game is a land race limited by frontier length and speed, not
by troops (growth easily pays 16 troops/tile).

**Improve / change.** Consider letting expansion be *directed* (click point biases
direction) like player attacks.

---

### 3.9 Combat: attack resolution

**Purpose.** The heart of the game: turning committed troops into territory.

**Source.** `src/core/execution/AttackExecution.ts`, `src/core/game/AttackImpl.ts`,
`Config.attackLogic` (pure function, pinned by `tests/AttackLogicGolden.test.ts`),
`RetreatExecution.ts`, `execution/utils/FlatBinaryHeap.ts`.

**Launching (player-facing).** Left-click enemy (or neutral) land you border → an
attack intent with `troops = currentTroops × attackRatio` (default ratio **20%**, keys
`T`/`Y` change it by 10%). Repeated clicks on the same target **merge** into one
attack.

**On init.**
1. Validate: target exists, not self, not friendly (ally/teammate), not immune.
2. Side effects: target gets a **temporary embargo** against the attacker (no trade
   for 5 min) and any pending alliance request from the target is rejected; the
   target's AI relation toward the attacker drops (−60 to −100 by difficulty).
3. Remove troops from the attacker's pool into the attack.
4. **Opposing attacks cancel**: if the target is attacking us, the two attack stacks
   subtract from each other; the larger survives with the difference.
5. Merge with our other land attacks on the same target (boat attacks don't merge).
6. Seed a priority queue with all target tiles adjacent to our border.

**Each tick.**
```
borderSize = attack frontier size + random(0..4)
budget = 1.0
while budget > 0:
    if attack troops < 1:            attack ends (all spent)
    if queue empty:                  attack ends, survivors return home
    t = pop lowest-priority tile; skip if no longer target-owned or not adjacent to us
    push t's target-owned neighbors into the queue
    (attackerLoss, defenderLoss, tickFraction) = attackLogic(...)
    budget        -= tickFraction
    attack troops -= attackerLoss
    defender pool -= defenderLoss
    conquer t; if defender now < 100 tiles → eliminate (§3.11)
```

**Priority (which tiles fall first).**
```
priority = (random(10..16)) · (1 − 0.5·n + m/2) + tickDiscovered
  n = number of the tile's neighbors we already own (0..4)
  m = 1 plains, 1.5 highland, 2 mountain
```
Lower = sooner. Discovery tick dominates → a **wave** advancing from our border;
tiles surrounded by our land fill first (smooths the front); mountains lag. The random
factor makes fronts look organic.

**Per-tile outcome vs. a player (v34 model).**
```
r = defenderTroops / attackTroops                        (how outnumbered we are)
d = defenderTroops / defenderTiles                       (defender density)
mag, tileCost from terrain (×5 / ×3 within a defense post's range; × fallout modifier)

attackerLoss = mag · traitor(0.5 if defender is traitor) · clamp(r, 0.6, 2)
               · (0.463 · bigA · bigD + 0.0039 · d)
defenderLoss = d
speedCost    = clamp(r, 0.82, 7.5) · clamp(r/20, 1, 50) / 8.55
tickFraction = speedCost · tileCost · bigA_speed · bigD · traitorSpeed(0.8) / borderSize

bigA / bigD / bigA_speed = "large territory" logistic factors in log(tiles):
   ≈1 below ~100k tiles, halfway at 300k, floors 0.3 / 0.7 / 0.27.
Human/nation attacking a bot: mag × 0.7. Attacking a disconnected teammate: mag = 0.
```

**Worked example (our arithmetic).** Defender: 200,000 troops on 2,000 plains tiles
(d = 100). Attacker sends 100,000 (r = 2): loss ≈ 80·2·(0.463+0.39) ≈ **137 per tile**;
defender loses **100 per tile**; the attack can take ~730 tiles. Sending 200,000
instead (r = 1): loss ≈ **68 per tile** — the same army is twice as efficient *and*
faster (≈0.52 × frontier tiles per tick vs ≈0.26). **Committing more is cheaper per
tile.**

**Retreat.** Clicking × on an attack: it stops advancing immediately, troops return
after **20 ticks**, minus a **25% penalty** if the target is a player (none vs neutral).

**Interactions.** Defender's global pool shrinks on every front at once; alliances
cancel ongoing attacks (retreat without penalty); defense posts and fallout raise
costs; encirclement (§3.10) can steal whole regions mid-attack.

**Observations.**
- No local troop positions — combat is pool vs. pool along a front. Very readable.
- **Attacks cover the entire shared border.** There is no way to aim at a region;
  this is the long-requested, never-shipped GitHub issue #112 "Directed attack".
- Attack stacks are effectively troop storage that doesn't count toward the cap (§6).

**Reproduce.** Commit-a-percentage; troops leave the pool; per-tick budget ∝ frontier;
ratio-scaled attacker losses; defender loses density; merging; opposing cancellation;
wave priority with terrain delay; retreat with penalty.

**Improve / change.** Directed attacks (bias priority toward the click point); clear
win/lose feedback (show army remaining, capture rate, estimated tiles); include troops
in the field in the cap.

---

### 3.10 Encirclement & annexation

**Source.** `src/core/execution/PlayerExecution.ts` (`removeClusters`,
`surroundedBySamePlayer`, `isSurrounded`, `isEnclosed`, `getCapturingPlayer`).

**Behavior.** Every 20 ticks (every tick under 100 tiles), each player's border tiles
are grouped into connected clusters (8-connected). A territory piece is **annexed**
— instantly, with no troop cost — when it is completely walled in by other players:
it touches no ocean shore, no map edge, no unowned land, and (for the main body) only
**one** enemy surrounds it. Secondary pieces surrounded by any enemies go to the
neighbor with the **largest active attack** on this player, else the neighbor with the
longest shared border. A final flood-fill check confirms the land changing hands is
truly sealed in (handles holes/craters).

**Player-facing.** "If you fully surround a territory, you get all of it instantly"
(wiki). Coasts are safe from encirclement.

**Observations.** This is what makes *border geometry* matter: cut an enemy in half
and the landlocked part may fall instantly. It is computationally expensive (flood
fills), hence throttled.

**Reproduce.** Yes — a core source of strategic depth, especially combined with
directed attacks.

---

### 3.11 Elimination

**Source.** `AttackExecution.handleDeadDefender`, `GameImpl.conquerPlayer`,
`PlayerExecution.removeOnDeath`, `Config.conquerGoldAmount`.

**Behavior.** When an attacked player drops **below 100 tiles**, they are conquered:
the attacker absorbs every remaining tile adjacent to it, other tiles go to adjacent
hostile neighbors (repeated passes). The conqueror receives **half the victim's gold**
(all of it for bots/nations) — unless the victim was a human who never attacked
anyone. A player with 0 tiles is dead: gold cleared, non-nuke units deleted,
alliances removed. Death position/kill stats are recorded.

**Improve / change.** Keep a small-territory threshold (avoids tedious mop-up); make
elimination a visible moment (toast + map effect).

---

### 3.12 Win conditions & anti-stall

**Source.** `src/core/execution/WinCheckExecution.ts`, `Config.percentageTilesOwnedToWin`,
`DoomsdayClockExecution.ts`, `game/DoomsdayClock.ts`.

**Behavior.** Checked every 10 ticks after the spawn phase.
- **FFA:** the largest player wins with **> 80% of non-fallout land**.
- **Teams:** same threshold on the team's combined land (bot team can't win).
- **Timer:** optional game length (1–120 min); hard limit **170 min** → largest wins.
- **Overtime (optional):** after N minutes (default 30) the threshold drops 2
  points/minute until someone qualifies.
- **Doomsday Clock (optional mode):** a rising minimum-territory bar; players below it
  get a warning, then troops drain to a floor, then territory rots away — a
  battle-royale "zone".
- **Ranked:** 1v1 ends when one connected human remains; 2v2 is voided if not all
  four spawned.

**Observations.** 80% is a long finish; the two anti-stall systems were added later
because games stalled. Victory is *announced by clients* and confirmed by majority
vote (§3.25).

**Improve / change.** Design anti-stall in from the start; consider a lower threshold
or "dominance" rules; make victory server-authoritative.

---

### 3.13 Gold economy

**Source.** `Config.goldAdditionRate`, `tradeShipGold`, `trainGold`,
`conquerGoldAmount`, `PlayerExecution.tick`, `TradeShipExecution`, `TrainExecution`.

**Behavior & formulas.**
- **Passive income is flat:** **100 gold/tick** (1,000/s) for humans and nations, 50
  for bots — *independent of territory*. (Older versions split population into
  workers vs. troops; that system is gone — only stat names remain.)
- **Trade ships** (§3.16): both ports' owners earn
  `75,000 / (1 + e^(−0.03·(distance − 300))) + 50·distance` per completed trip.
  (≈5k at 100 tiles, ≈52k at 300, ≈105k at 600.)
- **Trains** (factories, cities and ports linked by rail): per stop, 10k (own), 25k
  (team/other), 35k (ally); −5k per city visited beyond 10, floor 5k.
- **Conquest:** half the victim's gold (all from bots/nations).
- **Donations** between allies (§3.20). Host options: starting gold, gold multiplier.
- Global "saturation" curves throttle total trade ships and trains in huge lobbies.

**Observations.** Territory produces *troops*; infrastructure and trade produce
*gold*. That keeps gold from snowballing with land and makes diplomacy economic
(embargo = no trade; allies get the best train income). It is also the least
transparent part of the game — heavily tuned curves that players can't see.

**Improve / change.** A more legible economy (see GAME_DESIGN.md); Phase 2.

---

### 3.14 Buildings & construction

**Source.** `Config.unitInfo`, `ConstructionExecution.ts`, `PlayerImpl.buildableUnits /
canBuild / validStructureSpawnTiles`, `CityExecution`, `DefensePostExecution`,
`PortExecution`, `FactoryExecution`, `MissileSiloExecution`, `SAMLauncherExecution`,
`UpgradeStructureExecution`.

| Building | Cost (n = number already built) | Build time | Purpose |
|---|---|---|---|
| City | min(1M, 2^n · 125k) | 2 s | +250k max troops per level; rail station |
| Port | min(1M, 2^n · 125k) (shares count with Factory) | 5 s | Trade ships, builds warships, rail station |
| Factory | min(1M, 2^n · 125k) (shares count with Port) | 2 s | Spawns trains on the rail network |
| Defense Post | min(250k, (n+1) · 50k) | 5 s | Attacks within 30 tiles cost the attacker 5× and are 3× slower |
| Missile Silo | 1M | 10 s | Launches nukes (cooldown 90 ticks) |
| SAM Launcher | min(3M, (n+1) · 1.5M) | 30 s | Intercepts nukes; range 70 → ~150 with levels |

Rules: gold is paid up front; structures need ≥ 15 tiles spacing; most are
**upgradable** (levels; buying again near an existing one upgrades it; bulk upgrades
up to ×50). Captured territory **captures** the structures on it (defense posts are
destroyed instead). "Instant build" is a host option.

**Observations.** Each building has a sharp role. Cities are the core gold→troops
converter; defense posts create real chokepoints.

**Improve / change.** Keep a small, sharp roster; make each building's effect visible on
the map (e.g., defense radius overlay on hover).

---

### 3.15 Transport ships (naval invasion)

**Source.** `TransportShipExecution.ts`, `game/TransportShipUtils.ts`,
`pathfinding/` (water A*, hierarchical graph), `BoatRetreatExecution.ts`.

**Behavior.** Clicking land you can't reach by land (or pressing `B`) sends a transport
from your best shore tile (no port needed). Default troops: 1/5 of your troops (client
sends the attack ratio). **Max 3 boats** at once. The boat follows a water path (one
tile per tick); the target is warned ("Naval invasion incoming"). On landing it
conquers the landing tile and starts a normal attack **from that tile**. If the
destination becomes ours, troops return with 25% loss; boats can be recalled.
Warships sink transports (troops lost).

**Observations.** The landing tile acts as an attack *source* — the engine already
supports focused attacks; only land attacks lack it.

**Improve / change.** Phase 2. Keep "launch from any coast", limit concurrent boats,
show route & ETA, count boat troops toward the cap.

---

### 3.16 Trade ships & ports

**Behavior.** Every 10 ticks each port may spawn a trade ship (probability ≈ 1/100
with a "pity timer" and global saturation) to a random port of a trading partner
(not embargoed). Gold scales with distance (§3.13). Warships can capture enemy trade
ships ("piracy"). Recently-protected ships are "safe from pirates" for a short time.

**Improve / change.** Phase 2/3; make trade routes visible and protectable.

---

### 3.17 Warships & naval combat

**Source.** `WarshipExecution.ts`, `ShellExecution.ts`, `MoveWarshipExecution.ts`.

**Behavior.** Built at ports (cost min(1M, (n+1)·250k), 1000 HP). Patrols around a
chosen tile (range 100), targets enemies within 130: priority transport ships →
warships → trade ships (captures them). Fires shells (250 dmg, every 20 ticks). Retreats
to a port to repair at ≤ 75% health; passive healing; veterancy levels from kills
(+20% HP/damage per level, max 3). Players can select (box-select) and move warships.

**Improve / change.** Phase 3+ (only after naval transport proves fun).

---

### 3.18 Nuclear weapons & SAMs

**Source.** `NukeExecution.ts`, `MIRVExecution.ts`, `SAMLauncherExecution.ts`,
`SAMMissileExecution.ts`, `Config.nukeMagnitudes / nukeDeathFactor`.

| Weapon | Cost | Blast radius (inner / outer) | Notes |
|---|---|---|---|
| Atom Bomb | 750k | 12 / 30 | |
| Hydrogen Bomb | 5M | 80 / 100 | |
| MIRV | 25M + 15M per MIRV ever launched | warheads 12 / 18 | splits into many warheads over a player |

**Behavior.** Launched from the nearest ready silo on a parabolic trajectory; tiles in
the inner radius (and ~50% of the outer ring) are relinquished and become **fallout**;
troops die in proportion to land lost; units/structures in radius are destroyed.
Fallout land costs 5× (decaying with total fallout) to attack, is excluded from the win
percentage, and is reclaimable. SAMs pre-compute intercept points and shoot nukes in
range (cooldown). Nuking an ally (≥ 100 tiles of their land) breaks the alliance and
marks you a traitor. Optional "water nukes" turn land to water.

**Observations.** The late-game spectacle and the main counter to runaway leaders.
Complex to balance and to render.

**Improve / change.** Phase 4+ if at all; our design should first prove that the core
territory game is fun without it.

---

### 3.19 Alliances, betrayal & relations

**Source.** `execution/alliance/*`, `AllianceImpl.ts`, `AllianceRequestImpl.ts`,
`GameImpl.breakAlliance / expireAlliance`, `PlayerImpl.canSendAllianceRequest /
markTraitor / relation / decayRelations`.

**Behavior.**
- Send a request (right-click → handshake, or `K`). It expires after **20 s**; you
  can re-request the same player after **30 s**. If they had already requested you,
  sending a request accepts theirs.
- Allies **cannot attack each other**; an alliance formed mid-attack makes the attack
  retreat (no penalty). Accepting clears auto-embargoes and cancels nukes between them.
- Alliances last **5 minutes** (host-configurable 1–15, or disabled). In the last
  30 s both players are prompted; if **both** agree, it extends.
- **Breaking** an alliance (`L`) marks the breaker a **traitor for 30 s**: attackers
  lose only **0.5×** troops against them and move **0.8×** time per tile (faster).
  Betrayals are counted and shown.
- **Relations** (AI-only memory): −100…+100 per player, decaying toward 0 by 0.05 per
  tick; Hostile < −50 < Distrustful < 0 < Neutral < 50 < Friendly.
- **Embargo:** stops trade between two players; attacking creates a 5-minute temporary
  embargo automatically.
- **Target player:** mark a player as a target (shown to allies); 10 s duration, 15 s
  cooldown.

**Observations.** Simple tools, rich behavior. Alliances expiring by default forces
recurring decisions; the traitor debuff makes betrayal costly but possible.

**Reproduce.** Request/accept with expiry; timed alliances with mutual renewal;
traitor debuff; no attacking allies.

---

### 3.20 Resource sharing & communication

**Source.** `DonateGoldExecution`, `DonateTroopExecution`, `EmojiExecution`,
`QuickChatExecution`, `PlayerImpl.canDonate*`.

**Behavior.** Allies/teammates can donate troops (default ⅓ of yours) or gold;
**10 s cooldown** per recipient; hosts can disable donations to humans. Emojis (5 s
display, 5 s cooldown) and a phrase-based **quick chat** (3 s cooldown) — no free text
in game. Players can embargo individuals or everyone.

**Observations.** Free text is avoided (moderation). Quick chat + emoji is enough for
coordination.

---

### 3.21 Tribes (filler bots)

**Source.** `TribeExecution.ts`, `TribeSpawner.ts`, `utils/AiAttackBehavior.ts`.

**Behavior.** Each bot "thinks" every **40–80 ticks** (randomized per bot, staggered).
First action: expand into neutral land. Then: accept all alliance requests and
extensions; delete any structures it captured; attack neighboring traitors (1/3
chance, 1/6 if allied — breaking the alliance first); keep expanding into neutral land
while possible; otherwise attack a random neighbor. Personality ratios per bot:
trigger 50–60%, reserve 30–40%, expand 10–20% of max troops.

**Observations.** Cheap, predictable, weak — and that's the point.

---

### 3.22 Nations (smart AI)

**Source.** `NationExecution.ts`, `execution/nation/*` (alliance, structure, nuke,
MIRV, warship, emoji behaviors), `utils/AiAttackBehavior.ts`.

**Behavior.**
- **Reaction time by difficulty:** Easy 6.5–10 s, Medium 5.5–7 s, Hard 4.5–6 s,
  Impossible 3–5 s between decisions.
- **Attack decision:** always expand into non-nuked neutral land first; occasionally
  try boat attacks; then save up to a *reserve ratio* (30–40% of max) and usually a
  *trigger ratio* (50–60%) before attacking; Hard/Impossible retaliate immediately.
- **Strategy order by difficulty** (first that succeeds wins):
  - Easy: nuked land, bots, retaliate, assist allies, betray, hated, weakest
  - Medium: bots, nuked, assist, betray, hated, AFK players, traitors, leader ("crown"), weakest, islands, donate
  - Hard: bots, assist, betray, nuked, traitor, AFK, hated, very weak, "juicy" target, victim, crown, weakest, island, donate
  - Impossible: bots, very weak, betray, assist, victim, crown, traitor, juicy, AFK, nuked, hated, weakest, island, donate
- **Troop safety (Hard/Impossible FFA):** never drop below 75%/90% of the strongest
  non-allied neighbor's troops; skip attacks sending < 20% of the target's troops.
- **Easy/Medium** sometimes refuse to attack humans (kinder to beginners).
- **Alliances:** accept/reject based on threat, relation, early-game randomness and
  "similar strength"; easy nations are "confused" sometimes; impossible nations
  rarely ally and refuse in team games.
- **Building:** ratio-driven (e.g., ports per city), defense posts on threatened
  borders, silos/SAMs later; nuke and MIRV behaviors target leaders.

**Observations.** Same commands as humans; difficulty = speed + priorities (+ stat
multipliers). ~7,400 lines of AI code — sophisticated and battle-tested.

**Improve / change.** Start with a compact, readable utility-based AI (expand →
evaluate targets by weakness/threat/opportunity → act), personalities instead of 400
copies, no stat bonuses.

---

### 3.23 Networking protocol

**Source.** `src/core/Schemas.ts`, `src/core/ZbinWire.ts`, `zbin/`, `client/Transport.ts`,
`server/SocketIngress.ts`.

**Behavior.**
- Client → server: `join` / `rejoin` (with last seen turn), `intent`, `hash`
  (per 10 ticks), `winner` vote, `ping`, logs, reports.
- Server → client: `lobby_info`, `prestart` (map to preload), `start` (game config +
  all turns so far), `turn` (every 100 ms), `desync`, `error`, `pong`, redirects.
- **Every intent is stamped server-side with the sender's `clientID`** — clients cannot
  act for others.
- All messages are Zod schemas; WebSocket frames use a compact custom binary encoding
  ("zbin"); HTTP stays JSON.
- ~25 intent types: attack, cancel_attack, spawn, boat, cancel_boat, build_unit,
  upgrade_structure, delete_unit, move_warship, alliance request/reject/break/extend,
  target, emoji, quick_chat, donate gold/troops, embargo/embargo_all, pause, kick, etc.

**Constants.** Turn interval **100 ms**; intents ≤ 2,000 bytes; ≤ 10 intents/s and
150/min per client; ≤ 5 MB total per client; ≤ 5 rejoins/min.

**Observations.** Bandwidth is tiny (only intents travel). Input latency = time to the
next turn boundary + network round trip (~100–250 ms) — acceptable for this genre.

---

### 3.24 Server architecture & scaling

**Source.** `src/server/Server.ts`, `Master.ts`, `Worker.ts`, `GameManager.ts`,
`GameServer.ts`, `MapPlaylist.ts`, `docs/MultiServer.md`.

**Behavior.** Node `cluster`: the **master** serves the page shell and schedules public
lobbies (map playlist with weighted frequencies and random "modifiers"); **workers**
host games (routing by game ID). `GameServer` keeps the turn log, ends a turn every
100 ms (unless paused), broadcasts it, prunes stale clients, archives finished games to
the API. All static assets come from a CDN.

**Observations.** Per their own planning doc, **one machine handles current load**; the
multi-server plan is a contingency. This is the economic payoff of not simulating on
the server.

---

### 3.25 Synchronization, desync detection & anti-cheat

**Source.** `server/DesyncDetector.ts`, `server/Consensus.ts`, `server/VoteTally.ts`,
`server/IntentAuthorization.ts`, `server/ClientMsgRateLimiter.ts`, `SpawnExecution`
(intent security comments).

**How a client is prevented from cheating.**
1. **Identity:** the server stamps `clientID` on intents; per-intent authorization
   (e.g., only the lobby creator may kick or change config; `mark_disconnected` is
   server-only).
2. **Validation in the simulation:** every execution re-checks legality (enough
   troops/gold, adjacency, cooldowns, spawn-phase timing, valid tile refs). Since every
   client runs the same checks, an illegal intent is a no-op everywhere.
3. **Desync detection:** clients send a state hash every 10 ticks; every 10 turns the
   server compares the hashes for the turn 10 back. Clients disagreeing with the
   majority are told once and **lose their vote** for the rest of the game.
4. **Winner by consensus:** each client reports the winner; the result needs a
   **strict majority of unique IPs** among eligible (non-desynced, non-kicked,
   non-spectator) clients.
5. **Rate limits and size limits** on messages.

**Weaknesses.**
- The server never knows the true state; outcomes are *claims* settled by vote.
  A colluding majority (or a game with one human) can't be verified.
- Every client has the full state — no hidden information is possible (fine for a
  game without fog of war).
- Automation (scripted clicking, perfect timing) can't be detected by state checks.
- A desynced client gets an error modal; there's no automatic resync.

---

### 3.26 Reconnects, late joins & spectators

**Source.** `GameServer.rejoinClient`, `ClientGameRunner` (`transport.rejoinGame(turnsSeen)`),
`MarkDisconnectedExecution`, `PlayerImpl.isFriendly(…, treatAFKFriendly)`.

**Behavior.** A reconnecting client sends its last seen turn; the server replies with
all turns since then and the client **re-simulates them** (the worker runs up to 4 ticks
before yielding). After **30 s without pings** a player is marked disconnected:
teammates may capture their land without losses and take their ships; allies treat
them as non-friendly. Spectators join a lobby watch-only and receive the same turns.

**Observations.** Rejoining late in a long game means fast-forwarding tens of thousands
of ticks — the hidden cost of pure lockstep. Snapshots exist but are used for
pause/resume and replay seeking, not rejoin.

**Improve / change.** Server-held snapshots for instant rejoin/spectate.

---

### 3.27 Lobbies, matchmaking & game modes

**Behavior.** Home page lists upcoming public lobbies with countdowns and player counts
(e.g., 66/85 Africa FFA). Types: Singleplayer, Public (scheduled by the server's
playlist), Private (host creates, shares link; host can set options and cheats).
Modes: **FFA**, **Teams** (a chosen number of colored teams, or Duos/Trios/Quads, or
Humans vs Nations),
**Ranked** 1v1 and 2v2 matchmaking. Public "modifiers": compact map, random spawn,
crowded, hard nations, starting gold, gold multiplier, disabled alliances/ports/nukes/
SAMs, peace time, water nukes, doomsday clock. Team games may define spawn areas.

**Observations.** The solo setup screen exposes ~20 options (tribes 400, nations 72,
instant build, infinite gold/troops, game length, alliance duration, overtime,
disable 11 unit types…). Powerful, but a lot for a new player.

---

### 3.28 Single-player, replays & snapshots

**Source.** `client/LocalServer.ts`, `client/replay/`, `docs/Replays.md`,
`core/snapshot/`.

**Behavior.**
- **Single-player runs a `LocalServer` inside the browser** that produces turns on the
  same 100 ms cadence and stamps intents — the client code path is identical to
  multiplayer. It supports pause and speed changes.
- **Replays:** a finished game's record (config + turns) is re-simulated in the viewer's
  browser; hashes recorded during the live game are re-checked. Records only replay on
  the exact build that produced them (determinism is per build).
- **Snapshots:** the full core state can be serialized at a tick boundary (~1.2 MB
  gzipped for a late-game World map with 400 bots) and restored; versioned with
  migrations. Used for pause/resume, forking, replay seeking.

**Reproduce.** The local-server pattern (one code path for solo and multiplayer);
record = config + turns.

---

### 3.29 Client architecture & threading

**Source.** `src/core/worker/Worker.worker.ts`, `WorkerClient.ts`, `client/ClientGameRunner.ts`,
`client/view/GameView.ts`.

**Behavior.** The core runs in a **Web Worker**. Each tick the worker posts a
`GameUpdateViewData` with typed arrays (tile changes as `(tile, state)` pairs, unit
motion plans, player stats) sent as **transferables** (zero-copy). The main thread's
`GameView` mirrors the state for UI and rendering. UI queries that need the core
(e.g., "can I build here?") are async request/response messages to the worker. The
worker runs at most **4 ticks before yielding** so catch-up doesn't flood the main
thread.

**Reproduce.** Simulation off the main thread; packed deltas; async queries.

---

### 3.30 Rendering

**Source.** `src/client/render/` (has its own `CLAUDE.md`), `gl/Renderer.ts`,
`gl/passes/TerritoryPass.ts`, `gl/passes/BorderComputePass.ts`,
`gl/shaders/map-overlay/territory.frag.glsl`, `gl/shaders/border-compute/*`,
`client/WebGLFrameBuilder.ts`, `client/hud/NameBoxCalculator.ts`, GitHub issue #893.

**How it draws thousands of changing tiles efficiently.**
1. The tile **state array is uploaded as an `R16UI` texture** (owner + flags). First
   frame: full upload. Then only **dirty rows** are re-uploaded each tick.
2. A full-map quad is drawn; the **fragment shader** reads the owner of the tile
   under each pixel (`texelFetch`), looks up the player's color in a **palette
   texture**, applies patterns/skins, hover highlight, defense shading, fallout.
3. A **border-compute pass** renders a map-sized texture where each texel is marked
   as border if any of its 4 neighbors has a different owner, plus the *relationship*
   to that neighbor (friendly/embargo) for colored borders; highlighted players get
   thicker borders via a neighborhood search.
4. **Drip smoothing:** each tick's changed tiles are hashed into 12 buckets and one
   bucket is applied per 60 Hz frame — conquest appears to flow continuously although
   the simulation ticks at 10 Hz.
5. ~30 passes: terrain, map layers, territory, borders, structures, units (instanced),
   names (SDF-style text with flags), FX (shockwaves, attack rings), day/night lighting,
   nuke trajectories, range circles, selection boxes, etc. Settings live in JSON.
6. **Labels:** names are placed in the **largest inscribed rectangle** of the player's
   largest territory cluster (computed on a downsampled grid every 30 ticks), font
   sized to fit.
7. **History:** OpenFront started on **Canvas2D**; `putImageData`/`drawImage` became a
   bottleneck, especially in Firefox (issues #440, #893). They migrated (briefly via
   Pixi for some layers) to raw WebGL2.

**Visual observations (live game).** Territory is a solid fill of the player color;
borders are a darker/lighter shade, crisp but **pixel-stepped** (each tile is a hard
square). Names are large, centered, with troop counts beneath. Terrain is fairly
saturated and noisy.

**Reproduce.** GPU texture of ownership, shader coloring, GPU border detection, dirty
uploads, frame-spread animation, inscribed-rectangle labels.

**Improve / change.** Smoother, zoom-aware borders; more restrained terrain palette;
animated fronts showing where fighting happens; capture flashes.

---

### 3.31 Camera & input

**Source.** `client/TransformHandler.ts`, `client/InputHandler.ts`,
`core/game/UserSettings.ts` (`getDefaultKeybinds`), `hud/layers/RadialMenu*.ts`.

**Desktop controls (defaults).**

| Input | Action |
|---|---|
| Left click (enemy/neutral land) | Attack with current ratio (auto-boat if across water) |
| Left click (spawn phase) | Choose spawn |
| Right click | Radial menu (attack, info, boat, alliance…) |
| Wheel / Q, E | Zoom out / in |
| Drag / W A S D | Pan |
| C | Center on your territory |
| T / Y | Attack ratio −/+ 10% (increment configurable) |
| B / G | Boat attack / ground attack under cursor |
| 1–0 | Build City, Factory, Port, Defense Post, Silo, SAM, Warship, Atom, Hydrogen, MIRV |
| K / L | Request / break alliance |
| Shift+R | Retaliate |
| Ctrl/⌘ + click | Build menu · Alt + click: emoji menu |
| Shift + drag / F | Box-select / select all warships |
| Space | Toggle alternate (relations) view · M: coordinate grid |
| P, `,` `.` | Pause, game speed (single-player) |
| Esc | Close menus / cancel |

All keybinds are user-configurable. Input goes to a transparent overlay above the
canvas and is turned into events on an event bus; controllers translate events into
renderer state and intents.

---

### 3.32 UI/UX & HUD

**Source.** `client/hud/layers/*` (37 Lit components), observed in the live game.

**Home page.** Logo + version, nav (Play, Store, Inventory, Leaderboard, Clans), news
banner, auto-generated name ("AnonSteel8") with clan-tag field, a featured public lobby
card with countdown and player count, "upcoming" lobbies, big buttons: **Solo**,
**Tutorial**, **Create Lobby**, **Ranked**, **Join Lobby**. Footer shows
"© OpenFront™ and Contributors". Ads are present.

**In game (desktop, observed).**
- Top-left: **leaderboard table** (rank, name, % land, gold, troops), 253+ rows.
- Top-right: timer, speed, pause, settings, fullscreen, exit.
- Bottom-center: **control panel** — troop rate (+374/s), troop bar `current / max`,
  gold, **attack ratio slider** (20% (690)), and a **build hotbar** with counts.
- Hovering a player shows a top bar: name, type, gold, troops `x / max`, structures.
- Right-click radial menu with sword (attack) center and alliance/boat/info segments.
- An event feed (attacks, alliances, gold), a 22-step tutorial overlay in the first
  solo game, toasts and a win modal.

**Observations.** Functional and information-dense but busy: a large permanent table
and a long hotbar compete with the map; numbers are displayed ÷10.

---

### 3.33 Sound & events

**Source.** `client/sound/` (Howler-based `SoundManager`, `AudioMixer`, `CuePlayer`,
`MenuMusic`). Channels: master, music, effects, alerts, ambience, interface. Ambience
loops for cities/factories/silos. Sounds/music are in `/proprietary` (all rights
reserved).

**Improve / change.** Phase 4: a small, tasteful, original sound set; alerts for
incoming attacks and eliminations.

---

### 3.34 Settings & persistence

**Source.** `core/game/UserSettings.ts` (localStorage). Covers keybinds, attack ratio
and increment, audio volumes, graphics presets and per-layer toggles, dark mode,
emoji/alert toggles, colorblind theme, etc. There is no server-side persistence
without an account (the closed API handles accounts, stats, cosmetics).

---

### 3.35 Performance techniques

- Typed arrays for all per-tile state; no per-tile objects.
- Incremental border sets; `territoryVersion` counters to memoize expensive queries.
- Zero-allocation neighbor iteration (reused buffers) in hot loops.
- Throttled expensive work: cluster/encirclement checks every 20 ticks with per-player
  offsets; name placement every 30 ticks; port checks every 10 ticks; AI think
  intervals staggered.
- Hierarchical water pathfinding on a downsampled map; staggered path rebuilds.
- Packed tile/player updates as transferable buffers.
- GPU ownership texture with dirty-row uploads; frame-spread application.
- Headless perf benchmarks (`npm run perf:game`) and client perf tests in CI.

---

### 3.36 Mobile controls

**Behavior.** Tap = left click; **long-press** (touch) opens a crosshair/selection
mode and the radial menu; pinch to zoom (including Safari gesture events); drag to pan.
A recent fix shows the computed troop count in the mobile attack-ratio control.

**Observations.** Playable but desktop-first; precision on small screens is the main
challenge (tiles are tiny).

---

## 4. How the systems interact

```
            ┌───────────── more land ─────────────┐
            ▼                                     │
   Territory (tiles L) ──► Max troops M ∝ L^0.6 ──┼──► Troop growth g(T, M)
            ▲                       ▲             │        (peaks near 0.42·M)
            │                       │ cities      │              │
            │                       │ (+250k/lvl) │              ▼
            │                 Gold ─┘             │       Troop pool T
            │                  ▲                  │          │   │
            │   trade/trains ──┤                  │  commit %│   │ defends everywhere
            │   conquest ──────┤                  │          ▼   ▼
            │   flat income ───┘                  │      Attack army ──► front (frontier size)
            │                                     │          │
            └──── conquered tiles ◄── per-tile costs (terrain, ratio, density,
                                          defense posts, traitor, size bonuses)
                  encirclement ──► whole pockets change hands
                  elimination (<100 tiles) ──► gold transfer
```

- **Territory → economy:** land raises troop *capacity*; it does **not** raise gold.
- **Commitment → regeneration:** troops sent away lower T; if T was above the sweet
  spot, growth goes **up**. Holding at max is wasteful.
- **Border → combat:** speed per tick ∝ frontier size; the defender's whole pool
  defends; a long border with a strong neighbor is a liability *for both*.
- **Transfer of territory:** tile by tile through the attack queue, or in bulk via
  encirclement/elimination.
- **Diplomacy → economy & war:** allies can't attack each other, trade more, can
  donate; betrayal temporarily cripples the traitor's defense.

---

## 5. Direct answers to our research questions

| Question | Answer (from source) |
|---|---|
| How does territory size affect economy? | It raises **max troops** (∝ tiles^0.6) and therefore troop growth (∝ ~tiles^0.44). Passive **gold is flat** (100/tick) regardless of land; gold scales with ports, factories, trade partners and conquest. |
| How does troop commitment affect regeneration? | Committed troops leave the pool. Growth = (10 + T^0.73/4)(1 − T/M) peaks near T ≈ 0.42·M, so spending from above the sweet spot *raises* growth; spending below it lowers growth. Troops in attacks don't count toward the cap. |
| How is an attack resolved? | Troops go into an attack army; every tick the army conquers frontier tiles from a priority queue until a time budget (∝ frontier size) is spent. Each tile costs the attacker terrain × clamp(defender/attacker, 0.6, 2) × (base + density term) and costs the defender their average troops per tile. Ends when troops run out or nothing remains to conquer (survivors return). |
| How does the border between two players affect combat? | Attacks target the *entire* shared border; more frontier tiles = more tiles per tick. Terrain along the border sets cost and speed. Fully enclosed pockets are annexed. Coasts protect against encirclement. |
| How is territory physically transferred? | `conquer(tile)` sets the 12-bit owner in the tile state array, updates both players' tile and border sets, logs a packed `(tile, state)` change for the client. |
| How frequently does simulation update? | 10 ticks/s (100 ms). Server turns also every 100 ms. Rendering at display rate (60+ fps) with changes dripped across frames. |
| What is authoritative on the server? | Only the **order and content of intents** (turn log) and the sender identity stamped on each. Game state is not computed on the server; winners and live stats are settled by client majority vote. |
| How does the client render thousands of changing cells efficiently? | Owner IDs in a 16-bit GPU texture, dirty-row sub-uploads, palette lookup and border detection in shaders, changes spread over frames. |
| How does OpenFront prevent clients from declaring themselves the winner? | Server stamps identity on intents; every client re-validates every intent in the deterministic sim; state hashes every 10 ticks detect divergent clients (who lose their vote); the winner requires a strict majority of unique IPs. |

---

## 6. Known exploits & weaknesses

| Issue | Cause | Lesson for us |
|---|---|---|
| **Boat stacking** — troops on boats don't count toward max troops; launch & recall to exceed the cap (wiki) | Cap only counts the home pool | Count troops in the field toward the cap |
| **Attack storage** — slow attacks hold troops above the cap while the pool regrows | Same | Same |
| **Nuke grace abuse** — destroy an ally's coastal port with < 100 tiles of damage without becoming a traitor | Fixed threshold | Any deliberate damage to an ally should count |
| **Single-pixel ally capture** via a boat whose target changed owner | Edge case in landing rules | Validate landings against friendliness |
| **Winner by vote** — unverifiable outcomes, majority collusion possible | No server simulation | Server-authoritative outcome |
| **No resync after desync** | Pure lockstep | Server snapshots to resync clients |
| **Long rejoin catch-up** | Replay from turn 0 / last turn | Snapshot-based rejoin |
| **80% win threshold → stalls** | Late game turtling | Anti-stall designed in from day one |
| **Colorblind / too few colors in big lobbies** (issues #2165, #1912, #1307) | Large player counts | Perceptual color allocation, colorblind theme, relation view |
| **Firefox Canvas2D performance** (issues #440, #893, #3651) | CPU pixel pushing | GPU rendering from the start |

---

## 7. Preserve vs. redesign

| Preserve (proven) | Redesign (our improvements) |
|---|---|
| Troops as the single early resource; percentage commitment | **Directed attacks** — aim with the click point |
| Mid-capacity growth peak; sublinear capacity | Show the sweet spot on the troop bar; real numbers, no ÷10 |
| Global defender pool; density-based defender loss | Count troops in the field toward the cap |
| Per-tick budget ∝ frontier; ratio-scaled attacker loss | Clear battle feedback: fronts glow, army remaining, est. capture |
| Opposing attacks cancel; clicks merge | Minimal, contextual HUD instead of a permanent table + hotbar |
| Encirclement/annexation; small-territory elimination | Server-authoritative outcomes (hybrid lockstep), snapshot rejoin |
| Short spawn immunity; instant solo start | Anti-stall designed in; fewer setup options with good defaults |
| Deterministic sim, intents/turns, local server for solo | Systems in explicit order instead of an execution bag |
| GPU texture rendering, dirty uploads, frame-spread animation | Smooth zoom-aware borders, restrained palette, capture flashes |
| AI uses the same commands as humans | No AI resource bonuses; personalities; fewer, better bots |
| Timed alliances with mutual renewal; traitor debuff | Legible economy where territory matters but doesn't snowball |
| Config-driven constants + golden tests | Same, plus headless bot-vs-bot balance runs |

---

## 8. Glossary

- **Tick** — one simulation step (100 ms).
- **Turn** — the server's bundle of intents for one tick.
- **Intent** — a player's requested action, before validation.
- **Execution** — OpenFront's per-action state machine that mutates the game.
- **Terra Nullius** — unowned land (owner ID 0).
- **smallID** — compact numeric player ID stored in tile state.
- **Frontier / border size** — number of enemy tiles adjacent to the attacker for a
  given attack; drives attack speed.
- **Density** — a player's troops ÷ tiles.
- **Sweet spot** — the troop fraction where growth is maximal (~42% of max in OpenFront).
- **Encirclement / annexation** — instant capture of a fully enclosed pocket.
- **Traitor** — a player who broke an alliance in the last 30 s (weakened defense).
- **Desync** — a client whose state hash disagrees with the majority.
- **Lockstep** — every client runs the same deterministic simulation from the same inputs.
