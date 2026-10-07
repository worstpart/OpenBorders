# Phase 2 handoff — gameplay depth complete

> **For the next session: read this file first, then the docs it points to.** The repo
> docs are the source of truth, not chat history. Written 2026-10-06 at the end of
> Phase 2. Git tag **`phase-2`** marks the finished phase. This file replaces the Phase 2
> mid-phase handoffs (`PHASE_2_AFTER_2.1` … `2.9`), which stay only as history. The
> working agreements (§4) carry over from [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md),
> updated here.

---

## 1. Where we are

| | |
|---|---|
| Project | **OpenBorder** (D-014) — browser real-time territory strategy game inspired by OpenFront.io, built independently (clean room, D-001: never copy OpenFront code, text or assets) |
| Phase 0 · Phase 1 | ✅ · ✅ tag `phase-1` |
| **Phase 2 (gameplay depth)** | ✅ **tagged `phase-2`** — the user played it all together at 2.10 and approved: *"I really like the way it's playing and feels. Everything is looking great."* No balance changes were made in 2.10 |
| **Next** | ⬜ **Phase 2B — air & strategic warfare**, milestone **2B.0 flight foundation** (ROADMAP "Phase 2B"); bots first (D-021) |
| Then | Phase 3 multiplayer (D-006 still open) · Phase 4 polish · Phase 5 production |
| Parked | Real-world maps (D-026: World, Europe, North America, East Asia with real country names; source undecided) — ask the user when to schedule |
| Tests | 346 passing (`npm test`), type check clean (`npm run check`), Prettier clean (`npm run format:check`), `npm run build` OK |
| Bots-only baseline | ROADMAP "Milestone 2.10 result": Continent 8.9 min median · Islands 20.5 · Two lands 12.9 · tribe lobby 11.8 · Islands 2 teams 6.2 — no errors, every game has a winner |

**What a player can do today (on top of Phase 1):** start screen with 1–125 opponents,
nations (Easy/Medium/Hard) + tribes, Teams, map type **Continent / Islands / Two lands**,
size **Normal / Large / Huge**, Map #N and 🎲 → expand and fight → **alliances** (timed,
renewable, betrayal = traitor) → **gold**, Mobilize, gifts (troops only over a shared
border), loot → **buildings** Housing, Factory, Port at levels I–III (build bar, key B,
building cards, capture adopts the building) → **walls** drawn point by point (Palisade,
Stone Wall, Fortress Wall) → **boats** from any coast, beachhead landings, recall →
**trade ships** between Ports of different players → **alerts** (synthesized sounds,
rate-limited), incoming-threat chips/rings/edge arrows, **map pings** (G) and **emojis**.
Nations do all of it (tribes don't build); the sim runs in a Web Worker.

## 2. Read these, in this order

1. [`docs/ROADMAP.md`](../ROADMAP.md) — **Phase 2B table (2B.0–2B.6)**, its "bots first"
   rule and dependency map; the 2.5–2.10 result blocks (metrics to compare against).
2. [`docs/GAME_DESIGN.md`](../GAME_DESIGN.md) **§3.17** (buildings & strategic warfare —
   §3.17.7 Airports/SAMs, §3.17.8 Missile Silo, §3.17.10 the price/level matrix, §3.17.11
   counters, §3.17.12 economy fit, §3.17.13 UI), then §3.18 boats, §3.19 trade, §3.20 alerts
   (the incoming-threat list 2B reuses).
3. [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) **§5.7** (buildings, ranges and flights —
   the flight part is the 2B.0 plan), §5.6 hosts (WorkerHost), §6 client.
4. [`docs/DECISIONS.md`](../DECISIONS.md) **D-021** (building system + 2B placement), **D-023**
   (air rules; troops to friends only by border or airlift), D-024 (walls; Fortress Wall
   flak comes in 2B), D-025/D-026 (boats, trade, piracy in 2B.6), D-027 (alerts).
5. [`docs/OPENFRONT_RESEARCH.md`](../OPENFRONT_RESEARCH.md) for SAMs/silos/warships
   background — ideas only.

## 3. Phase 2 in one table

| # | Built | Decision |
|---|---|---|
| 2.0 | Big lobbies (1–125 opponents), Large map, 126 colours, per-system tick timing | D-016 |
| 2.1 | Tribes (weak filler, dull brown) & Nations (Easy/Medium/Hard) | D-017 |
| 2.2 | Alliances: 20 s requests, 5-min alliances with renewal, traitor 30 s; nations weigh traitors ×2 | D-018 |
| 2.3 | Teams: fixed sides, combined land wins, alliances unchanged, tribes teamless | D-019 |
| 2.4 | Gold (10 + 0.8·√tiles per tick), Mobilize, gifts, full loot with a gold border animation | D-020 |
| 2.5 | Building framework, range module, Housing & Factory I–III, build bar, capture adopts | D-021, D-023 |
| 2.6 | Walls drawn A, B, C (replaced border posts the same day) | D-024 |
| 2.7 | Islands always (continent + 5–7 islands), boats, beachheads, Port I–II, Marines | D-025 |
| 2.8 | Trade ships, map types & sizes, map worker, **WorkerHost**, sea-route distance field | D-026 |
| 2.9 | Alert sounds (retuned after play), threat list, pings, emojis, nations act on pings | D-027 |
| 2.10 | Playtest approved; baseline metrics recorded; no changes | — |

## 4. How the user wants us to work (unchanged, collected)

- The user is **not an expert game developer**. Lead, explain in plain language, flag
  problems early; for major problems give WHAT / WHY / OPTIONS / RECOMMENDATION.
- Ask only on decisions that **materially change the game or direction**; decide minor
  things yourself and note them in the docs. When the user asks for something, **place it
  in the right phase/milestone first** (tuning → current milestone; new systems →
  roadmap) and say where and why.
- **No fake systems**; placeholders clearly labelled.
- After every change: **run it, test it, check the console, verify in the browser**.
  Balance with the headless runner; when a change must not alter bots-only games, compare
  seed by seed against a worktree of the previous commit (done in 2.9).
- **Start each milestone by asking the user to playtest the previous one** (a short
  guided list of what to try, then what to report).
- **Sound:** alerts only, rare and rate-limited per source; never triggerable by other
  players' spam; pings/emojis silent; boat horn kept; betrayals alert everyone. 2B
  flights/missiles reuse the boat-horn style threat alert (`client/app/alerts.ts`).
- The user **plays in the browser pane** while we work. Use your own tab, warn that
  edits hot-reload and reset their game, keep checks quick, run long jobs in the
  background, and **never stop the dev server at the end of a turn** (it broke their game
  once).
- Git: commit at stable points, messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Keep docs current.
  **After every handoff: push to `origin` (+ tags) and confirm `main` = `origin/main`.**
- Handoff after each phase (and mid-phase when a session gets long), then a fresh chat
  (D-015).

## 5. Environment facts & gotchas

| Fact | Detail |
|---|---|
| Node / npm | Node 24.19.0, npm 11.17.0 (if npm shows 8.x, an old global npm in `%APPDATA%\npm` shadows it) |
| Python | Not installed — script with `node` |
| Shell | Never put backticks in double-quoted strings. Long inline `node -e`/heredoc scripts with quotes/backticks can fail: write them to the scratchpad and run `node file.cjs < /dev/null`. `cat > file` without a heredoc hangs |
| Dev servers | `.claude/launch.json`: `dev` 5173, `dev-alt` 5174, `dev-3`…`dev-6` 5175–5178, `dev-7` 5181. Other chats often hold several; take the first free one via the preview tool (2.10 used **`dev-4`, 5176**). Other chats' servers watch this folder too, so edits hot-reload there as well |
| Workers | The sim runs in `simWorker.ts` (WorkerHost) and maps generate in `mapWorker.ts` (falls back to the main thread if the worker fails). Sim edits hot-reload the page |
| Browser pane | Hidden pane ⇒ rAF stops (Svelte transitions never finish, long awaits time out at 45 s) — keep scripted checks short. After HMR, `import("/src/…")` needs the `?t=` URL from `performance.getEntriesByType("resource")`. Screenshots are ~800 px wide while the viewport is ~1412 CSS px: scale coordinates. The `scroll` action may click first — zoom via a WheelEvent on `#map` |
| Debug hook (dev only) | `window.__openborder`: speed, pause/resume, `frame()`, `renderer()`, `send(cmd)`, `sendAs(playerId, cmd)`, `sound()` log (the pane can't be heard) |
| Console buffer | Keeps stale messages across reloads; log a marker first |
| Headless timing | Ticks spike when the machine is busy (dev servers starting, other chats); rerun before suspecting the game. Each worker's first bot think builds per-map sea data (~80–130 ms, once) |
| Prettier | Reflows code; scripted exact-string replacements after formatting may miss |
| Golden tests | troop curve, attack speeds/crush curve — meant to fail when balance changes; update deliberately |

## 6. Repository map

```
src/sim/               deterministic simulation (no DOM, no packages; guard-tested)
  rules.ts             every tunable number with its reason (buildings, walls, naval, trade, chat…)
  world.ts tick.ts commands.ts events.ts frame.ts stateHash.ts battle.ts geometry.ts (range module)
  map/                 gameMap.ts, noise.ts, generate.ts (continent / archipelago / twin, islands)
  math/                rng.ts (sfc32), detmath.ts, hash.ts
  systems/             spawn, troops, attacks (+ tileQueue), encirclement, elimination, victory,
                       diplomacy, economy, buildings, walls, naval (boats, sea routes), trade, chat
  ai/                  bot.ts (nations + tribes), build.ts (what/where nations build), chat.ts (pings, emojis)
src/host/              host.ts (SimHost), localHost.ts, workerHost.ts + simWorker.ts + workerProtocol.ts,
                       mapGeneration.ts + mapWorker.ts
src/client/
  app/                 client.ts (wiring, rAF, debug hook), setup, players, teams, diplomacy, economy,
                       buildings, boats, threats (incoming list — add 2B flights/missiles here),
                       alerts (AlertPlanner), chat, toasts, hints, preview, focus, attackPercent, troopBar
  audio/sound.ts       synthesized alerts, volume/mute in localStorage
  render/              renderer.ts, shaders/, terrainTexture, labels, buildings, boats, markers, perfOverlay
  ui/                  App.svelte, hud/ (CommandBar, BuildBar, BuildingCard, BuildingIcon, ContextMenu,
                       DiplomacyCards, AttackChips, HoverCard, Leaderboard, Toasts, …), screens/ (Start, Pause, End)
tools/                 headless.ts, speeds.ts, maps.ts (map previews), rulesFile.ts (--rules overrides)
tests/                 guards/, helpers/, sim/, client/, host/ (40 files, 346 tests)
docs/                  ARCHITECTURE · DECISIONS · GAME_DESIGN · OPENFRONT_RESEARCH · ROADMAP · handoffs/
```

Commands: `npm run dev` (use the preview tool instead), `npm test`, `npm run check`,
`npm run format:check`, `npm run build`, `npm run headless -- --games 60 [--bots N]
[--tribes N] [--teams N] [--style continent|archipelago|twin] [--size normal|large|huge]
[--no-buildings|--no-boats|--no-trade|--continent …] [--json out.json] [--quiet]`
(~1 min per 60 Continent games on 7 workers), `node tools/speeds.ts`, `node tools/maps.ts`.

## 7. Key numbers

Everything lives in `src/sim/rules.ts`; the building/wall/Port prices and effects are the
✅ rows of GAME_DESIGN §3.17.10. Phase 1's core numbers (troops, attacks, victory) are in
`PHASE_1_HANDOFF.md` §7 and unchanged. Income 10 + 0.8·√tiles gold per tick; nations earn
~1.0k / 1.9k / 2.6k gold/s at minutes 1 / 3 / 6. First building ~1:12, first L2 ~3:05,
first L3 ~7–9 min (when the game lasts that long).

## 8. Known issues / open items

| Item | Where it goes |
|---|---|
| Aggressors win few Continent games (5/60; 2/30 in tribe lobbies) | 2B.6 balance pass (air units change the picture) |
| Islands free-for-alls run ~20.5 min (top of the accepted 15–20) | 2B.6 — measure again with air |
| Team games end fast (~6 min on Islands, 2 teams) → L3 buildings and air rarely appear there | 2B playtests; options: higher team win share, or accept |
| Nations build only one Port; no embargo; settle islands only when no open land touches them | later, if asked |
| Nation pings to human friends are unit-tested, not yet seen in a long browser game | next browser session |
| Spatial grid for buildings not built (linear scans fine) | **2B.2** (SAM radii need it) |
| No gold column on the leaderboard; EndCard "your team won" path unit-tested only; one unconfirmed Renew-click glitch (2.2) | Phase 4 polish / next browser session |
| Edge arrows on the right can sit under the leaderboard | Phase 4 polish |
| Fuller sound (effects, music) | Phase 4 (D-027) |
| Real-world maps | parked (D-026) |

## 9. Next steps — Phase 2B, milestone 2B.0 (flight foundation)

**Done when (ROADMAP):** a test flight launches, flies, arrives and renders; same seed ⇒
same hash. **Bots first** (D-021): sim + nation AI before human controls.

1. **Re-read the 2B design** (GAME_DESIGN §3.17.7–3.17.8, ARCHITECTURE §5.7) against what
   Phase 2 actually built — walls replaced posts (flak is now the Fortress Wall's), boats'
   beachhead attack is the landing mechanism to reuse, `threats.ts`/`alerts.ts` exist —
   and update any stale lines before coding. Ask the user only if something changes the
   game (e.g. flight speeds that make air feel like teleporting).
2. **Sim:** `world.flights` — straight-line flights with analytic positions
   (launch tick, from, to, speed → position at any tick, no per-tick stepping),
   deterministic ids, hashed in `stateHash`; launch / arrival / interception events;
   frames carry flights; cooldown/charge bookkeeping on buildings. Use the range module
   (`geometry.ts`: `distance`, `withinRange`, `travelTicks`).
3. **Client:** flight glyph + dotted route + ETA, range rings in action mode; incoming
   flights join the threat list (chips, rings, edge arrows) with a rate-limited
   horn-style alert (§4 sound rule).
4. **Tests:** analytic position math, determinism (same seed ⇒ same hash), events; bots-only
   games without flights must stay identical to `phase-2` (seed-by-seed worktree
   comparison).
5. **Verify** in the browser (own tab) with a debug-launched test flight; update ROADMAP /
   ARCHITECTURE / GAME_DESIGN; commit "Phase 2B.0: flight foundation".

Then 2B.1 Airport I + airlift (the second way to send troops to a friend, D-023), 2B.2 SAMs
(+ the spatial grid), 2B.3 airborne assault, 2B.4 air strikes, 2B.5 Missile Silo, 2B.6
Port III + warships + the full balance pass.

## 10. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2_HANDOFF.md`, then the docs it lists, and start Phase 2B
> with milestone 2B.0 (flight foundation), bots first. Follow the working agreements in
> the handoff.
