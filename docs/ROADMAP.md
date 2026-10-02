# Roadmap

> Each phase ends with something we can run, test and judge. We move on only when the
> current phase is genuinely solid. Status markers: ✅ done · 🟡 in progress · ⬜ not started.

| Phase | Goal | Status |
|---|---|---|
| **0 — Research** | Understand OpenFront; design our architecture and first slice | ✅ (awaiting your review) |
| **1 — Playable prototype** | Prove the core loop is fun: spawn → expand → fight bots → win/lose | ⬜ |
| **2 — Gameplay depth** | Economy, buildings, naval transport, diplomacy, better AI, more maps | ⬜ |
| **3 — Multiplayer** | Authoritative server, lobbies, reconnects, spectators | ⬜ |
| **4 — Polish** | Animation, sound, onboarding, mobile, accessibility, settings | ⬜ |
| **5 — Production** | Accounts, profiles, leaderboards, deployment, monitoring, scaling | ⬜ |

---

## Phase 0 — Research ✅

- [x] Study the live game, the official repository (source over docs), wiki and GitHub issues
- [x] Licensing analysis (`OPENFRONT_RESEARCH.md` §1)
- [x] Systems reference (`OPENFRONT_RESEARCH.md`)
- [x] Rendering benchmark spike (`spikes/render-benchmark/`, results in `ARCHITECTURE.md` §4)
- [x] Game design draft (`GAME_DESIGN.md`)
- [x] Architecture proposal (`ARCHITECTURE.md`), decision log (`DECISIONS.md`)
- [x] Feature matrix and risk register (below)
- [ ] **Your review + decisions** (licensing path, Node upgrade, name, open questions)

---

## Phase 1 — Playable prototype

### The vertical slice — exactly what's in

**OPEN BROWSER → START GAME → SPAWN → EXPAND → FIGHT BOTS → WIN / LOSE**

| Area | Included |
|---|---|
| Start | Minimal start screen: **Play** (+ number of opponents) |
| Map | One procedurally generated continent (fixed seed), plains/highland/mountain/water |
| Camera | Drag to pan, wheel zoom toward cursor, WASD/arrows, Space = center on me |
| Spawn | Click to choose a start; bots spawn automatically; 5 s spawn protection |
| Neutral land | Directed expansion into unowned land, terrain-dependent cost & speed |
| Troops | Capacity from land, regeneration with a 50% sweet spot, troops in the field count toward the cap |
| Attack % | Presets 10/25/50/75/100, keys 1–5, Q/E ±5, Shift+wheel; send preview on the troop bar |
| Attacks | Directed attacks on neighbors, per-tile losses, front-width speed, merging, opposing attacks cancel, retreat |
| Capture | Tile-by-tile capture with capture flash; **encirclement** of enclosed pockets |
| AI | 7 opponents (configurable) with personalities, same commands as the player |
| Elimination | Small-territory absorption, zero-tile death, elimination toasts |
| Victory | 70% of land or last standing; victory/defeat card with basic stats and *Play again* |
| HUD | Command bar (troops + attack %), attack chips with odds and retreat, mini leaderboard, toasts, hover card with battle preview, basic right-click menu, pause menu, contextual hints |
| Rendering | WebGL2 terrain, territory, constant-width borders, fronts, labels; performance overlay |
| Engineering | Deterministic simulation with tests, local turn scheduler (`LocalHost`), headless bot-vs-bot runner |

### Explicitly out of Phase 1

Gold/economy, buildings, boats/naval, alliances/diplomacy, nukes, multiplayer/server,
accounts, sound, settings screens, mobile layout, matchmaking, cosmetics.
(Placeholders, if any, will be clearly labeled — no fake buttons.)

### Milestones

| # | Milestone | Done when |
|---|---|---|
| 1.0 | **Scaffold** — Vite + TS + Svelte + Vitest, folder structure, guard tests (banned APIs in `sim/`, import rules) | `npm run dev` serves the app shell; `npm test` passes; first commit |
| 1.1 | **Simulation core** — map + procedural generation, `GameRules`, world, players, troop capacity/growth, spawn command, tick loop, tick frames, state hash, ASCII-map test helper | Unit + golden tests pass; same seed ⇒ same hash |
| 1.2 | **Rendering & camera** — terrain, territory, borders, labels, camera, `LocalHost`, session wiring | Map renders at 60 fps in the browser, spawning visible, console clean |
| 1.3 | **Expansion & combat** — attack/retreat commands, directed priority, budgets & losses, merge/cancel, capture flash, fronts | Scenario tests on tiny maps pass; playable expansion & attacks in the browser |
| 1.4 | **Encirclement, elimination, victory** | Tests for each rule; full solo game reachable end-to-end |
| 1.5 | **AI opponents** — personalities, staggered thinking; headless runner | 100 bots-only games finish with a winner, no exceptions, within tick budget |
| 1.6 | **HUD & interaction** — command bar, attack % control, chips, leaderboard, toasts, hover card, context menu, start/pause/end screens, hints | Every control verified in the browser; keyboard paths work |
| 1.7 | **Playtest & tune** — balance via headless metrics + play sessions, performance pass | Matches ≈ 8–12 min, budgets met, stable commit tagged *phase-1* |

---

## Phase 2 — Gameplay depth (after Phase 1 is fun)

Ordered by expected impact; each item gets a design note in `GAME_DESIGN.md` before
implementation.

1. **Economy** — gold (model E2 + Mobilize prototype, see `GAME_DESIGN.md` §6.1)
2. **Buildings** — City, Fort, Port (+ Market if the economy needs it)
3. **Naval transport** — boats from any coast, routes, beachheads, recall
4. **Diplomacy** — alliance requests, timed alliances, betrayal, donations, pings
5. **Better AI** — threat/opportunity evaluation, alliances, boats, building
6. **Anti-stall** — declining win threshold
7. **More maps** — real-world maps via our own pipeline (public-domain data) and/or
   CC BY-SA maps if we choose to
8. **Sound & game events** — first pass
9. **WorkerHost** — move the simulation off the main thread when maps grow

## Phase 3 — Multiplayer

Authoritative Node server (hybrid lockstep, `ARCHITECTURE.md` §7), lobbies (create /
join by link / public), player names, reconnect via snapshots, spectators, server
browser / simple matchmaking, command validation & rate limits, desync detection +
resync, cross-browser determinism tests, teams mode.

## Phase 4 — Polish

UI and map animation pass, sound design, onboarding/tutorial, responsive layout and
**mobile controls**, accessibility (colorblind theme, contrast, reduced motion,
keyboard), settings & keybinds, performance on low-end devices, loading and error
handling, game statistics and post-game results, replays.

## Phase 5 — Production

Accounts, persistent profiles, match history, leaderboards, friends/parties (if
wanted), deployment architecture (CDN, game servers, database), analytics, moderation,
monitoring & alerting, production security review, scaling tests.

---

## Feature matrix

Complexity: **L** low · **M** medium · **H** high · **VH** very high.

| OpenFront feature | Our version | MVP (P1)? | Later? | Complexity | Notes |
|---|---|---|---|---|---|
| Tile grid with typed arrays | Same approach | ✅ | — | M | Foundation of performance |
| 132 real-world maps from PNGs | 1 procedural continent | ✅ (1 map) | P2: more, incl. real-world | M | Avoids licensing work in P1 |
| Camera pan/zoom | Smooth zoom-to-cursor, WASD, focus | ✅ | — | L | |
| Spawn phase (pick start) | Same + 5 s protection | ✅ | — | L | |
| Random-spawn option | — | — | P2 | L | |
| Neutral expansion (whole border) | **Directed** expansion | ✅ | — | M | |
| Troop growth & capacity | Own curve: 50% sweet spot, field troops count toward cap | ✅ | — | L | Fixes stockpile exploits |
| Attack-ratio slider (default 20%) | Presets + keys + Shift+wheel + send preview on troop bar | ✅ | — | L | |
| Land attacks along entire border | **Directed attacks** (focus point) | ✅ | — | H | Their oldest open request (#112) |
| Merge clicks / opposing attacks cancel | Same | ✅ | — | M | |
| Retreat (25% penalty) | Same idea (20%) | ✅ | — | L | |
| Encirclement / annexation | Same idea | ✅ | — | H | Flood fills; throttled |
| Elimination below 100 tiles | Below 40 tiles | ✅ | — | M | |
| Win at 80% land | 70% or last standing | ✅ | P2 anti-stall | L | |
| Overtime / Doomsday Clock | Declining threshold | — | P2 | L–M | |
| Terrain affects cost & speed | Same 3 classes | ✅ | — | L | |
| Tribes (400 filler bots) | Fewer bots with personalities | ✅ (basic) | — | M | |
| Nations (smart AI, 4 difficulties, stat bonuses) | No stat bonuses; difficulty = speed + decisions | Basic | P2 smarter | H | |
| Leaderboard table | Mini top-5 + you | ✅ | Full stats P4 | L | |
| Event feed | Toasts | ✅ | — | L | |
| 22-step tutorial | Contextual hints | ✅ (hints) | P4 onboarding | M | |
| Pause / game speed (solo) | Same | ✅ | — | L | |
| Flat gold + trade/trains | E2 + Mobilize (to be decided) | — | P2 | M | |
| City (+max troops) | City | — | P2 | L | |
| Defense Post | Fort | — | P2 | M | |
| Port | Port | — | P2 | M | |
| Factory + trains/railroads | Maybe a simpler Market | — | P3? | H | Complex & opaque in OpenFront |
| Structure levels/upgrades | Maybe | — | P2 | M | |
| Transport ships | Same + route/ETA preview | — | P2 | H | Water pathfinding |
| Trade ships | Maybe | — | P3 | M | Depends on economy model |
| Warships & naval combat | Maybe | — | P3+ | H | Only if transports are fun |
| Atom/Hydrogen/MIRV, silos, SAMs, fallout | Not planned | — | P4+ / never | VH | Core must be fun without them |
| Alliances (timed, mutual renewal) | Same | — | P2 | M | |
| Traitor debuff | Same | — | P2 | L | |
| Embargo | Only if we have trade | — | P3 | L | |
| Donate gold/troops | Same | — | P2 | L | |
| Emoji / quick chat | Pings & emotes | — | P2–P3 | L | No free text |
| Target-player marker | Maybe | — | P3 | L | |
| Teams / Duos / HvN | Teams | — | P3 | M | |
| Public/private lobbies | Yes | — | P3 | H | |
| Ranked 1v1/2v2 matchmaking | Later | — | P5 | H | |
| Relay-only lockstep server | **Hybrid authoritative lockstep** | — | P3 | VH | Server decides outcomes |
| Desync detection (majority hash) | Server hash + snapshot resync | — | P3 | H | |
| Reconnect (replay all turns) | Snapshot + recent turns | — | P3 | H | |
| Spectators | Yes | — | P3 | M | |
| Replays | Record = seed + commands | — | P4 | M | |
| Snapshots | Yes (needed for rejoin) | — | P3 | M | |
| Sound & music | Small original set | — | P4 | M | Their audio is all-rights-reserved |
| Settings & keybinds | Minimal → configurable | — | P4 | L | |
| Mobile controls | Designed now, built later | — | P4 | H | |
| Colorblind theme / relation view | Yes | — | P4 | L–M | |
| Accounts, stats, leaderboards | Yes | — | P5 | H | |
| Cosmetics, store, clans, Steam, ads | Out of scope | — | — | — | |
| Performance overlay | Yes | ✅ | — | L | |
| *(new)* Headless balance simulator | Bots-only runner with metrics | ✅ (basic) | — | M | |
| *(new)* Battle preview & odds labels | Hover + attack chips | ✅ | — | M | "Am I winning?" at a glance |

---

## Risk register — the five technically riskiest parts

| # | Risk | Why it matters | Mitigation | Early warning sign |
|---|---|---|---|---|
| 1 | **Cross-platform deterministic simulation** | Multiplayer (hybrid lockstep), replays and server authority all depend on every engine computing identical results; one float difference = desync | Integer state, banned-API tests, deterministic math module, ordered iteration, state hashes from day one; cross-browser hash tests by Phase 3 | Hash mismatches between two runs or two browsers |
| 2 | **Territory rendering quality & performance at scale** | It's the core visual; must stay smooth with millions of tiles and look premium (borders, animation, colors) | WebGL2 texture pipeline (benchmarked), dirty-block uploads, effects in shaders, perf overlay, re-run benchmark on low-end hardware/Firefox | Frame time > 16 ms, upload spikes, unreadable borders when zoomed out |
| 3 | **Balance & "fun"** | Snowballing, stalemates, turtling, exploits or bots that are too weak/strong make everything else irrelevant | All constants in `GameRules`, golden tests, headless bot-vs-bot metrics (game length, lead changes), short playtest loops, design properties stated up front | Early leader almost always wins; long passive periods; one dominant strategy |
| 4 | **Multiplayer authority, latency & recovery** | Input delay, reconnects, desync recovery, cheating and server cost all hinge on this design | Command/turn pipeline built in Phase 1; host abstraction; snapshots; server-side validation; load tests before launch; fallback to state deltas if needed | Commands feel laggy > 200 ms; rejoin takes seconds; server CPU per game too high |
| 5 | **Simulation CPU cost at scale** | Attack queues, border tracking, encirclement flood fills, AI and (later) pathfinding grow with map size and player count | Typed arrays, incremental borders, throttled/staggered work, per-system tick budgets in the headless runner, `WorkerHost` | Tick time > 10 ms on the reference map; GC pauses |

Secondary risks to watch: AI quality (believable bots), mobile usability on small
screens, naval pathfinding cost, color distinctness with many players, and keeping
scope under control.
