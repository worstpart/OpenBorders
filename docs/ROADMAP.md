# Roadmap

> Each phase ends with something we can run, test and judge. We move on only when the
> current phase is genuinely solid. Status markers: ✅ done · 🟡 in progress · ⬜ not started.

| Phase | Goal | Status |
|---|---|---|
| **0 — Research** | Understand OpenFront; design our architecture and first slice | ✅ |
| **1 — Playable prototype** | Prove the core loop is fun: spawn → expand → fight bots → win/lose | ✅ (tag `phase-1`) |
| **2 — Gameplay depth** | Big lobbies, Tribes & Nations, alliances, teams, then economy, buildings, naval, more maps | 🟡 2.0 ✅ 2.1 ✅ |
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
- [x] **Review + decisions** (2026-10-01): independent build, Node 24 installed, directed
      attacks + encirclement, generated map. Still open: final name (D-014), multiplayer
      model (D-006, needed by Phase 3)
- [x] Handoff written: [`docs/handoffs/PHASE_0_HANDOFF.md`](handoffs/PHASE_0_HANDOFF.md)

---

## Phase 1 — Playable prototype ✅

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
| 1.0 ✅ | **Scaffold** — Vite + TS + Svelte + Vitest, folder structure, guard tests (banned APIs in `sim/`, import rules) | `npm run dev` serves the app shell; `npm test` passes; first commit |
| 1.1 ✅ | **Simulation core** — map + procedural generation, `GameRules`, world, players, troop capacity/growth, spawn command, tick loop, tick frames, state hash, ASCII-map test helper | Unit + golden tests pass; same seed ⇒ same hash |
| 1.2 ✅ | **Rendering & camera** — terrain, territory, borders, labels, camera, `LocalHost`, session wiring | Map renders at 60 fps in the browser, spawning visible, console clean |
| 1.3 ✅ | **Expansion & combat** — attack/retreat commands, directed priority, budgets & losses, merge/cancel, capture flash, fronts | Scenario tests on tiny maps pass; playable expansion & attacks in the browser |
| 1.4 ✅ | **Encirclement, elimination, victory** | Tests for each rule; full solo game reachable end-to-end |
| 1.5 ✅ | **AI opponents** — personalities, staggered thinking; headless runner | 100 bots-only games finish with a winner, no exceptions, within tick budget |
| 1.6 ✅ | **HUD & interaction** — command bar, attack % control, chips, leaderboard, toasts, hover card, context menu, start/pause/end screens, hints | Every control verified in the browser; keyboard paths work |
| 1.7 ✅ | **Playtest & tune** — balance via headless metrics + play sessions, performance pass | Matches ≈ 8–12 min, budgets met, stable commit tagged *phase-1* |

**Milestone 1.5 result** (`npm run headless -- --games 100`, reference map, 8 bots, 86 s on
7 worker threads): **100/100 games finished with a winner**, 0 errors, 0 timeouts. Length
median 12.7 min (under 8: 1 · 8–12: 33 · 12–16: 51 · 16–20: 13 · 20–30: 1 · 50: 1). Leader at
minute 3 won 32%. Wins by personality: opportunist 32, expander 29, turtle 24, aggressor 15.
Tick 0.71 ms avg, worst p99 8.7 ms, worst single tick 30 ms.

**Milestone 1.6 result:** command bar with the sweet-spot troop bar and send preview,
attack chips with odds / threat and Counter, hover card with battle preview, right-click
menu, leaderboard + clock, toasts, pause menu with game speed, contextual hints — all
verified in the browser (mouse and keyboard paths: 1–5, Q/E, Esc, menu arrows/Enter,
Tab in the pause menu). As built: GAME_DESIGN §5.1, ARCHITECTURE §6. 139 tests.

**Milestone 1.7 result (2026-10-02)** — the user played, approved the feel ("feels good"),
and Phase 1 was tagged `phase-1`. The headless runner gained `--rules` (try rule
overrides from a JSON file), `--personality`, a 90%-land metric and a length histogram.

| 200 bot games | Before 1.7 | After |
|---|---|---|
| Finished with a winner | 100/100 (one 42 min, one 60-min timeout in other runs) | 200/200 |
| Median length | 10.1 min | 9.7 min (<8: 30 · 8–12: 134 · 12–16: 32 · 16–20: 1 · 20–30: 3) |
| Longest | 42–60 min (stalemates) | 24 min |
| 90% of land owned / all land | 3.1 / 4.8 min | 2.8 / 4.6 min |
| Leader at minute 3 wins | 37% | 31% |
| Wins by personality | opp 31 · turtle 28 · exp 25 · agg 16 (per 100) | opp 60 · exp 54 · turtle 51 · agg 35 (per 200) |
| Tick avg / worst p99 / worst max | 0.95 / 13.8 / 103 ms | 0.72 / 6.7 / 29 ms |

**After the user's playtest (same day):** "land grabs feel long", "a much bigger player
should crush a small one much faster", "grass fastest, mountains slow". Measured with
the new `tools/speeds.ts`, then tuned (GAME_DESIGN §3.5–3.6):

| Front speed (tiles/s) | Before | After |
|---|---|---|
| Open land: grass / highland / mountain | 2.9 / 2.4 / 1.9 | 6.3 / 3.7 / 1.5 |
| Attack on grass at 1× / 2× / 4× / 10× the defender | 2.0 / 3.8 / 5.7 / 5.7 | 2.0 / 5.8 / 14.4 / 19.8 |
| Attack on mountains at 1× | 1.4 | 0.7 |

200 bot games after it: 200/200 winners; median **7.1 min** (<8: 134 · 8–12: 58 · 12–16: 6
· 16–20: 1 · 20–30: 1), longest 24.5; 90% of land owned at **2.1 min**; leader at minute 3
won 35%; wins: turtle 81 · opportunist 50 · expander 44 · aggressor 25 (turtles gain from
mountain defence lines — revisit with Nations in 2.1); tick 0.75 avg / 7.3 worst p99 ms.
Browser: 165 fps, 0.5–1 ms CPU per frame, 0.4 ms per tick. Games are shorter than the
8–12 min target, accepted (GAME_DESIGN §7).

Earlier changes: bots size expansions to what their front can use and call back oversized ones
(GAME_DESIGN §3.11); anti-stall victory rule (§3.10). Tried and rejected: a growth floor
that scales with capacity (leader at minute 3 then won 44% instead of 31% — more
snowballing; the HUD's sweet-spot bar addresses overspending instead); four aggressor
variants (no change, see §3.11). Tick spikes of 78–103 ms in the baseline came from the
machine being busy (the same games alone: ≤ 24 ms).

**Notes collected for 1.7 (tuning):**
- Troop management dominates: a scripted player that only attacks at ≥ 50% of capacity
  won a solo game on the reference map in ~4 min of game time; one that always sent 70%
  needed ~36 min (growth near an empty pool is tiny). Decide whether the growth floor
  should scale with capacity (e.g. max(10, 0.0005·M)) so a big empire that overspends
  isn't stuck — and make the sweet spot very visible in the HUD (1.6).
- Land-race speed: confirm with 8 competing bots that the land race lasts ~60–90 s.
- Encirclement p99 tick spikes (3.4 ms) come from flooding huge territories; fine for
  now, revisit with many large players or move the sim to a worker.
- Occasional single ticks of 15–30 ms in headless runs (with 7 games in parallel; possibly
  GC) — profile them.
- Aggressors win least (15%) — they deplete themselves; consider tuning their thresholds.
- One game in 100 ran 50 min — look at what kept it going.
- Odds thresholds (GAME_DESIGN §5.1 as built) are a first guess — check in play that
  "Even" and "Costly" match what players experience.
- A Counter with a depleted pool is tiny (the button shows its size); consider whether
  the HUD should suggest a % for countering.

---

## Phase 2 — Gameplay depth 🟡

Each item gets a design note in `GAME_DESIGN.md` before implementation. Order set with
the user after the Phase 1 playtest (D-016): **scale, AI tiers, alliances and teams
first**, then the economy and the rest. Milestone numbers are a plan, not a promise —
each ends with headless metrics + a browser check, like Phase 1.

| # | Milestone | Done when |
|---|---|---|
| 2.0 ✅ | **Big lobbies — up to 125 opponents.** Start screen allows 1–125; spawn placement for many players; 125 distinct player colours and readable labels when zoomed out; leaderboard copes; bot thinking stays cheap (staggered, budgeted per tick); simulation moved to a worker if needed (`WorkerHost`); headless runner with 125 bots | 125-player games run within the tick and frame budgets; no exceptions in 100 headless games |
| 2.1 ✅ | **Tribes & Nations** — two AI tiers. *Tribes*: many small, simple filler bots that expand, accept alliances and fight nearby weak or traitorous neighbours (cheap to run, "food" that fills the map). *Nations*: few, smarter opponents (today's personality bots, improved), with names and difficulty levels (reaction time + decision quality). To decide in the design note: whether tribes get handicaps (OpenFront's are weaker by stats) — touches D-012 | Mixed lobbies (e.g. 100 tribes + 10 nations) feel right in play; tribes don't win; nations do |
| 2.2 | **Alliances** — request/accept (requests expire after 20 s, 30 s before asking the same player again), alliances last 5 min and both sides are asked to renew in the last 30 s, allies can't attack each other (running attacks pull back free), breaking one makes you a *traitor* for 30 s (attackers lose less and move faster against you); right-click menu + keys, request toasts with accept/decline, ally markers on map and leaderboard; tribes accept all, nations decide by threat/relations/strength | Every flow verified in the browser; bots ally, renew, betray believably |
| 2.3 | **Teams mode** — choose 2–N teams of players + bots, team colours, shared victory on combined land, no attacking teammates, team-aware AI (help teammates, gang up) | Team games end with a winning team; teammates never fight |
| 2.4 | **Economy** — gold (model E2 + Mobilize prototype, see `GAME_DESIGN.md` §6.1); donations between allies/teammates | |
| 2.5 | **Buildings** — City, Fort, Port (+ Market if the economy needs it) | |
| 2.6 | **Naval transport** — boats from any coast, routes, beachheads, recall | |
| 2.7 | **More maps** — bigger maps for big lobbies; real-world maps via our own pipeline (public-domain data) and/or CC BY-SA maps | |
| 2.8 | **Sound & game events** — first pass; pings & emotes | |

Anti-stall: a basic declining win threshold was done in 1.7; revisit for teams and big
lobbies.

**Milestone 2.0 result (2026-10-02)** — design note and decisions: GAME_DESIGN §3.12.
Start screen: 1–125 opponents (quick picks 7 · 25 · 50 · 125), map Normal or **Large**
(1560×990, ~2× the land), land-per-player line. Spawn spacing scales with the lobby;
126 generated colours (OKLab, closest pair 0.056); 136 names; other players'
eliminations toast only if they bordered you (lobbies > 16). The headless runner reports
time per tick step (`systemsMs`, slowest tick's steps).

| 100 games each | 8 bots, Normal (regression) | 126 bots, Normal | 126 bots, Large |
|---|---|---|---|
| Finished with a winner / errors | 100 / 0 | **100 / 0** | **100 / 0** |
| Median length (longest) | 7.1 min (15.5) — same as Phase 1 | 10.6 min (24.5) | 13.0 min (25) |
| 90% of land owned | 2.1 min | 0.6 min | 0.9 min |
| Leader at minute 3 wins | 33% | 12% | 4% |
| Wins: turtle / expander / opportunist / aggressor | 34 / 24 / 30 / 12 | **80** / 13 / 6 / 1 | **71** / 19 / 7 / 3 |
| Tick avg / worst p99 (7 games in parallel) | 0.73 / 6.9 ms | 1.2 / 8.2 ms | 2.1 / 18.1 ms |
| Tick avg / p99 / max, game alone | — | 0.8–1.1 / 3.4–4.2 / 10–12 ms | 1.4–1.7 / 10.2–10.7 / 19–20 ms |

- Where the time goes (126 bots, Normal): attacks 0.55 ms and encirclement 0.48 ms per
  tick on average; bots 0.07 ms — no per-tick thinking budget needed. The slowest tick of
  a game run alone is now the one-time placement of 126 spawns (~9 ms; ~30 ms before the
  spacing change). Spikes of 30–75 ms in the batch runs came from the machine being busy
  (the same seeds alone: ≤ 12 ms).
- **Large map is at the edge of the budget:** p99 ~10.5 ms and single ticks of ~20 ms,
  all from encirclement flood-fills of 500k-tile empires late in the game. Browser (Large,
  126 players): 165 fps, 0.5–1.3 ms CPU per frame, tick 1.0–3.1 ms avg as shown by the
  overlay; no visible hitches. **Decision:** no `WorkerHost` yet — the reference map meets
  every budget and the Large map's spikes are rare; moving the simulation to a worker and
  making encirclement incremental belong with the bigger maps of 2.7 (ARCHITECTURE §11).
- **Balance finding for 2.1:** in big lobbies turtles win 70–80% of games (8-bot games:
  34%). With 125 small neighbours, waiting for big edges and defending on mountains beats
  attacking; aggressors almost never win. Tribes & Nations (2.1) replace most of these bots
  anyway — the Nation AI must be checked against this. *(2.1: with tribes in the lobby the
  wins spread out again — see below.)*

**Milestone 2.1 result (2026-10-02)** — Tribes & Nations; design note GAME_DESIGN §3.13,
decision **D-017** (the user chose weaker tribes: ⅓ capacity, ½ growth, 0.7× losses for
whoever attacks them; nations stay fair, D-012). Start screen: Nations 0–25, Tribes 0–125
(quick picks 0 · 25 · 50 · 100), difficulty Easy · Medium · Hard. Tribes are dull
browns/tans with lighter labels (user request); the hover card says "Tribe · weak filler"
or "Nation · Medium · turtle"; the HUD's odds include the tribe discount. Headless:
`--tribes N --difficulty d` (`--bots` = nations), wins by tier.

| Headless games | Winner | Median (longest) | 90% land | Leader at min 3 wins | Tick avg / worst p99 |
|---|---|---|---|---|---|
| 10 nations + 100 tribes, Easy (50) | nation 50/50 | 16.7 min (25) | 1.1 min | 38% | 0.74 / 6.8 ms |
| … Medium (50) | nation 50/50 | 12.6 min (24.5) | 1.1 min | 24% | 0.78 / 7.3 ms |
| … Hard (50) | nation 50/50 | **9.7 min** (24.5) | 1.1 min | 28% | 0.86 / 6.7 ms |
| 15 nations + 110 tribes, Medium, Large (30) | nation 30/30 | 16.4 min (23.9) | 1.5 min | 10% | 1.6 / 15.7 ms* |
| 8 nations, no tribes (100, regression) | — | 7.1 min (15.5) | 2.1 min | 33% | 0.73 / 6.5 ms |

* 7 games in parallel; Large-map spikes are encirclement floods (see 2.0). The 8-nation
run is identical to Phase 1's: lobbies without tribes play exactly as before. No errors in
any run. Browser: 10 nations + 100 tribes on Normal at 4× — clean console, readable map.

Open for later: tribes don't yet react to alliances or traitors (2.2); nations don't
yet decide about alliances (2.2).

## Phase 3 — Multiplayer

Authoritative Node server (hybrid lockstep, `ARCHITECTURE.md` §7), lobbies (create /
join by link / public), player names, reconnect via snapshots, spectators, server
browser / simple matchmaking, command validation & rate limits, desync detection +
resync, cross-browser determinism tests, online teams (team games with bots come in 2.3).

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
| Win at 80% land | 70% or last standing, anti-stall | ✅ | — | L | |
| Overtime / Doomsday Clock | Declining threshold (70% → 50% after 15 min) | ✅ | — | L–M | Pulled into 1.7 to end stalemates |
| Terrain affects cost & speed | Same 3 classes | ✅ | — | L | |
| Tribes (400 filler bots) | Up to 125 tribes: ⅓ capacity, ½ growth, cheaper to attack, simple AI, brown colours | ✅ (basic) | ✅ 2.1 | M | D-016, D-017 |
| Nations (smart AI, 4 difficulties, stat bonuses) | Up to 25 nations; no stat bonuses; Easy/Medium/Hard = speed + decisions | Basic | ✅ 2.1 | H | D-016, D-017 |
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
| Alliances (timed, mutual renewal) | Same (5 min, renew in last 30 s, traitor 30 s) | — | P2 (2.2) | M | D-016 |
| Traitor debuff | Same | — | P2 | L | |
| Embargo | Only if we have trade | — | P3 | L | |
| Donate gold/troops | Same | — | P2 | L | |
| Emoji / quick chat | Pings & emotes | — | P2–P3 | L | No free text |
| Target-player marker | Maybe | — | P3 | L | |
| Teams / Duos / HvN | Teams (with bots in P2, online in P3) | — | P2 (2.3) | M | D-016 |
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
