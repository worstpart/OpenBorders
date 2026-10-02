# Phase 1 handoff — playable prototype complete

> **For the next session: read this file first, then the docs it points to.** The repo
> docs are the source of truth, not chat history. Written 2026-10-02 at the end of
> Phase 1. Git tag **`phase-1`** marks the finished prototype. This file replaces the
> Phase 1 mid-phase handoffs (`PHASE_1_MIDPOINT_HANDOFF.md`, `PHASE_1_AFTER_1.5/1.6`),
> which stay only as history.

---

## 1. Where we are

| | |
|---|---|
| Project | *Borderline* (placeholder name) — browser real-time territory strategy game inspired by OpenFront.io, built independently (clean room, D-001) |
| Phase 0 (research, docs, benchmark) | ✅ |
| **Phase 1 (playable prototype)** | ✅ **tagged `phase-1`** — the user played it and approved the feel ("feels good") |
| **Next** | ⬜ **Phase 2, milestone 2.0 — big lobbies (up to 125 opponents)**, then 2.1 Tribes & Nations, 2.2 alliances, 2.3 teams (D-016) |
| Tests | 144 passing (`npm test`), type check clean (`npm run check`), Prettier clean, `npm run build` OK |
| Bot balance (200 games, 8 bots) | 200/200 with a winner · median **7.1 min** · longest 24.5 · 90% of land owned at 2.1 min · leader at minute 3 wins 35% |
| Performance | Browser: 165 fps (display cap), 0.5–1 ms CPU per frame, ~0.4 ms per tick. Headless: 0.75 ms avg tick, worst p99 7.3 ms (budget 100 ms) |

**What a player can do today:** start screen (1–16 opponents) → pick a start → expand
into neutral land (directed, terrain-dependent) → attack bots with a chosen % (keys 1–5,
Q/E, Shift+wheel, presets) → see odds, previews, attack chips, counters, retreats →
encircle pockets → eliminate players → win at 70% of the land (dropping toward 50% after
15 min) or lose → victory/defeat card → play again. Pause menu with game speed,
leaderboard, toasts, hints, performance overlay (F3).

## 2. Read these, in this order

1. [`docs/ROADMAP.md`](../ROADMAP.md) — **Phase 2 milestone table (2.0–2.8)**, the
   milestone 1.7 results, the feature matrix.
2. [`docs/DECISIONS.md`](../DECISIONS.md) — especially **D-016** (Phase 2 order) and D-012
   (fair AI — to revisit for tribes in 2.1).
3. [`docs/OPENFRONT_RESEARCH.md`](../OPENFRONT_RESEARCH.md) **§3.4 player types, §3.12 teams
   win condition, §3.19 alliances, §3.20 donations, §3.21 Tribes, §3.22 Nations** — what
   the user means by these words. Ideas only; never copy code (D-001).
4. [`docs/GAME_DESIGN.md`](../GAME_DESIGN.md) §3 (rules as built, each with "As built"
   notes and the reasons for every number), §3.11 (AI), §5 (HUD as built).
5. [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §5 (simulation, tick order, attack model),
   §4.4 (renderer), §6 (HUD), §10 (testing).

## 3. Decisions in force

All of Phase 0's (D-001 … D-015) plus **D-016** (2026-10-02): Phase 2 starts with
**2.0 big lobbies (125 opponents) → 2.1 Tribes & Nations → 2.2 alliances → 2.3 teams**,
then economy, buildings, naval, maps, sound. Teams were moved up from Phase 3 (team games
against bots need no server). Open: D-006 multiplayer model (Phase 3), D-014 final name,
and — inside 2.1 — whether tribes get stat handicaps like OpenFront's or stay fair (D-012).

Balance choices made during Phase 1 (all documented with reasons in GAME_DESIGN):

| Choice | Where |
|---|---|
| Troops: capacity `10,000 + 1,000·L^0.6`, growth peaks at 50% of capacity; field troops count toward the cap | §3.4 |
| Open land ~6 tiles/s on grass, ~3.5 highland, ~1.5 mountains (1.7, user request) | §3.5 |
| Lanchester losses (`lossDensity` 1.2): ~10% more troops needed to take everything | §3.6 |
| **Crush curve** (1.7, user request): attack delay ∝ r^1.3 down to 1/20 → 2× ≈ 6, 4× ≈ 14, 10×+ ≈ 20 tiles/s; even fights ~2 tiles/s | §3.6 |
| Organic, vein-like spread; per-tile jitter is a share of the delay (`noiseShare`) | §3.5, §3.7 |
| Encirclement: pockets fall to any encloser; a main territory only to a single encloser attacking with ≥ their home troops | §3.8 |
| Absorption below 40 tiles only if ≤ 25% of peak land | §3.9 |
| **Anti-stall** (1.7): after 15 min the win requirement drops 1% per 30 s to 50% | §3.10 |
| Bots: 4 personalities, same commands as players, Lanchester target choice, right-sized expansions (1.7) | §3.11 |
| Odds labels from `sim/battle.ts` — the HUD and the bots use the same estimates | §5.1 |

Tried and rejected in 1.7 (don't retry without a new reason): a growth floor that scales
with capacity (more snowballing: leader at minute 3 won 44% vs 31%); four aggressor
tweaks (no effect — attacking costs more than defending); cheaper/pricier land costs
(no effect on land-race length).

## 4. How the user wants us to work

- The user is **not an expert game developer**. Lead, explain in plain language, flag
  problems early; for major problems give WHAT / WHY / OPTIONS / RECOMMENDATION.
- Ask only on decisions that **materially change the game or direction**; decide minor
  things yourself and note them in the docs.
- **No fake systems**; placeholders clearly labelled.
- After every change: **run it, test it, check the console, verify in the browser**.
  Measure balance with the headless runner, speeds with `tools/speeds.ts`.
- When the user asks for something, **place it in the right phase/milestone** first
  (tuning → current milestone; new systems → roadmap) and say where and why — they asked
  for this explicitly ("find the best phase or milestone… methodically and practical").
- The user **plays in the browser pane** while we work. Use your own tab
  (`tabs_create`), warn that edits to sim/renderer/shaders hot-reload and reset their
  game, keep checks quick, and run long jobs (headless) in the background.
- Git: commit at stable points, messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Keep docs current.
- **At the end of each phase write `docs/handoffs/PHASE_N_HANDOFF.md`** and tell the user
  to continue in a new chat (D-015). Mid-phase handoffs when a session gets long.

## 5. Environment facts & gotchas

| Fact | Detail |
|---|---|
| Node / npm | Node 24.19.0, npm 11.17.0. If `npm --version` shows 8.x, an old global npm in `%APPDATA%\npm` is shadowing it |
| Python | Not installed — script with `node` (`node - <<'EOF' … EOF` for quick edits; **don't also add `< /dev/null`**, it replaces the heredoc) |
| Shell quoting | Never put backticks inside double-quoted shell strings — they execute |
| Dev servers | `.claude/launch.json`: `dev` (5173), `dev-alt` (5174), **`dev-3` (5175)**. Other chats' servers often hold 5173/5174 — use the next free config via the preview tool, never Bash |
| Browser pane | Hidden pane ⇒ `requestAnimationFrame` stops (0 fps): frame-time checks need the pane visible (`tabs_context` says "displayed"/"hidden"). `__borderline.setSpeed()` does **not** resume a paused game — call `resume()`. The start-screen Play button needs the page loaded; wait for it before clicking |
| Debug hook (dev only) | `window.__borderline`: `setSpeed(x)`, `pause()`, `resume()`, `frame()`, `renderer()` (`map.ownerCapture`: owner at even indices, water 65535), `send(command)` as the local player. Scripted start: click Play → `send({type:"spawn", tile})` → click "Start here" |
| Perf overlay | F3 or backquote. A synthetic `KeyboardEvent('keydown', {code:'F3'})` on `window` toggles it |
| Console buffer | Keeps stale messages across reloads; log a marker first |
| Headless timing | Tick spikes of 70–100 ms appear when the machine is busy (e.g. starting a dev server); rerun the same seeds alone before suspecting the game |
| Prettier | Reflows code; exact-string scripted replacements after formatting may miss — re-read or use the Edit tool |
| Golden tests | `tests/sim/systems/troops.test.ts` pins the troop curve; speed tests in `attacks.test.ts` pin terrain order and the crush curve. They are meant to fail when balance changes — update them deliberately |

## 6. Repository map

```
src/sim/               deterministic simulation (no DOM, no packages; guard-tested)
  rules.ts             every tunable number, with its reason
  world.ts tick.ts commands.ts events.ts frame.ts stateHash.ts battle.ts (odds, shared by HUD + bots)
  map/                 gameMap.ts, noise.ts, generate.ts (procedural continent)
  math/                rng.ts (sfc32), detmath.ts (log/exp/pow), hash.ts
  systems/             spawn, troops, attacks (+ tileQueue), encirclement, elimination, victory (+ anti-stall)
  ai/bot.ts            bot brains (personalities in rules.ts)
src/host/              host.ts (SimHost), localHost.ts (turn scheduler)
src/client/
  app/                 client.ts (wiring, rAF loop, debug hook), uiState, players (names/colours, MAX_OPPONENTS=16),
                       attackPercent, focus, hints, preview, toasts, troopBar
  camera/ input/       camera.ts; controls.ts (keys), gesture.ts
  render/              renderer.ts, shaders/map.{vert,frag}, terrainTexture.ts, labels.ts, perfOverlay.ts
  ui/                  App.svelte, tokens.css, hud/ (CommandBar, AttackChips, HoverCard, ContextMenu,
                       Leaderboard (+ win goal), Toasts, HintCard, SpawnPrompt, YouChip), screens/ (Start, Pause, End)
tools/                 headless.ts (bots-only games), speeds.ts (front speeds), rulesFile.ts (--rules overrides)
tests/                 guards/, helpers/ (asciiMap.ts), sim/, client/, host/
docs/                  ARCHITECTURE · DECISIONS · GAME_DESIGN · OPENFRONT_RESEARCH · ROADMAP · handoffs/
spikes/                Phase 0 render benchmark (never imported)
```

Useful commands: `npm run headless -- --games 100 [--bots N] [--rules f.json]
[--personality turtle] [--json out.json]` (≈ 1 min per 100 games, 7 workers);
`node tools/speeds.ts [--rules f.json]`.

## 7. Key numbers in force (`src/sim/rules.ts`)

| Rule | Value |
|---|---|
| Capacity / growth | `M = 10,000 + 1,000·L^0.6`; growth `10·(1−x) + 0.044·M^0.75·4x(1−x)`, x = home/M |
| Spawn | radius 4 (49 tiles), 30% of M, 5 s protection, random spawns ≥ 70 tiles apart |
| Neutral | cost 3/4/6 per tile; 1.5 ticks per layer × terrain 1/1.7/4; full speed at ≥ 2,000 troops |
| PvP | loss `terrain × clamp(r,0.5,2.5) × (3 + 1.2·d)`; delay `4 × terrain(1/1.5/2.5) × clamp(r<1 ? r^1.3 : r, 0.05, 8)` |
| Fronts | focusSpread 0.35, focusPull 1, fillShare −0.4, noiseShare 0.67, veins 0.45/1.5; at most 2 layers per tick |
| Retreat | 2 s, −20% from players, free from neutral land |
| Encircle / eliminate | check every 20 ticks; absorb < 40 tiles and ≤ 25% of peak when attacked |
| Victory | 70% of land or last standing; after 15 min −1% per 30 s down to 50% |
| Bots | think every 2–5 s; counter at 1.1×, send 1.3×; expansions ≈ 15 s of front capacity (≥ 2,000, ≤ land in reach × 1.25) |

## 8. Next steps — Phase 2, milestone 2.0 (big lobbies: up to 125 opponents)

**Done when (ROADMAP):** 125-player games run within the tick and frame budgets; no
exceptions in 100 headless games.

1. **Design note first** in GAME_DESIGN (new §: "Big lobbies"): how many tiles per player
   at 125 (reference map 420k land tiles → ~3.4k each — tiny starts; consider a bigger
   map option), spawn radius/spacing, whether 2.0 already uses simple tribe-like bots or
   the current personalities. Keep it short; tribes proper are 2.1.
2. **Measure first:** `npm run headless -- --games 20 --bots 126` (works today?) — record
   tick avg/p99, which systems cost most (bot thinking, encirclement floods, attacks).
   Add a per-system timing breakdown to the runner if needed.
3. **Simulation scale:** stagger/budget bot thinking (fixed number of bots per tick),
   make sure encirclement and `landNeighbors` stay cheap with many small players; spawn
   placement for 126 players (`spawn.ts` relaxes distance — check it succeeds quickly).
   Move the sim to a Web Worker (`WorkerHost`, ARCHITECTURE) only if tick times demand it.
4. **Client scale:** `MAX_OPPONENTS` is 16 (= `BOT_COLORS` length in
   `src/client/app/players.ts`) → generate 125 distinct colours (e.g. golden-angle hues
   × lightness bands, avoid colours near the local player's blue) and enough names;
   start screen stepper up to 125 (add a faster way to pick, e.g. presets 7/31/63/125);
   labels must not clutter when zoomed out (hide labels of tiny territories); the
   leaderboard already shows top 5 + you; renderer's per-player arrays/uniforms sized
   dynamically (`renderer.setAttacks(…, playerCount)`).
5. **Verify:** 100 headless games at 125 bots, browser check at 1×/4× with F3 (frame CPU,
   tick), console clean, screenshots. Update ROADMAP/GAME_DESIGN/ARCHITECTURE, commit
   "Phase 2.0: big lobbies".

Then 2.1 Tribes & Nations (design note must settle D-012 for tribes), 2.2 alliances
(OpenFront timings: 20 s request expiry, 30 s re-request cooldown, 5-min alliances,
renewal prompt in the last 30 s, traitor 30 s), 2.3 teams.

## 9. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_1_HANDOFF.md`, then the docs it lists, and start Phase 2
> with milestone 2.0 (big lobbies, up to 125 opponents). Follow the working agreements
> in the handoff.
