# Roadmap

> Each phase ends with something we can run, test and judge. We move on only when the
> current phase is genuinely solid. Status markers: ✅ done · 🟡 in progress · ⬜ not started.

| Phase | Goal | Status |
|---|---|---|
| **0 — Research** | Understand OpenFront; design our architecture and first slice | ✅ |
| **1 — Playable prototype** | Prove the core loop is fun: spawn → expand → fight bots → win/lose | ✅ (tag `phase-1`) |
| **2 — Gameplay depth** | Big lobbies, Tribes & Nations, alliances, teams, economy, then buildings (3 levels), walls (Border Defense), naval, more maps | 🟡 2.0–2.6 ✅ · next 2.7 |
| **2B — Air & strategic warfare** *(PLANNED; placement chosen by the user 2026-10-02)* | Flights, Airports I–III, SAMs I–III, Missile Silos I–III, Port III — after Phase 2, **before** multiplayer; built bots-first (D-021) | ⬜ |
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
| 2.2 ✅ | **Alliances** — request/accept (requests expire after 20 s, 30 s before asking the same player again), alliances last 5 min and both sides are asked to renew in the last 30 s, allies can't attack each other (running attacks pull back free), breaking one makes you a *traitor* for 30 s (attackers lose less and move faster against you); right-click menu + keys, request toasts with accept/decline, ally markers on map and leaderboard; tribes accept all, nations decide by threat/relations/strength | Every flow verified in the browser; bots ally, renew, betray believably |
| 2.3 ✅ | **Teams mode** — choose 2–N teams of players + bots, team colours, shared victory on combined land, no attacking teammates, team-aware AI (help teammates, gang up) | Team games end with a winning team; teammates never fight |
| 2.4 ✅ | **Economy** — gold (model E2 + Mobilize prototype, see `GAME_DESIGN.md` §6.1); donations between allies/teammates | Gold earned, mobilized, given and looted in the browser; games no longer than before |
| 2.5 ✅ | **Building framework + Housing & Factory (levels I–III)** — design GAME_DESIGN §3.17. Foundation first: building data + `rules.buildings` definitions (costs, times, levels, ranges, effects — all in one place), the **unified range module** (`distance` / `withinRange` / `travelTicks`), a building spatial grid, `build` / `upgrade` / `cancelBuild` commands, construction & upgrade timers, levels I–III, spacing, capture (−1 level) and destruction, "level = health" (`damageBuilding` used later by strikes/missiles), price escalation; Housing (capacity, growth, Metropolis gold) and Factory (gold, Mobilize discount); building icons with level pips and construction/upgrade effects; build list (right-click own land, key B) with ghost placement and spacing ring; building card with upgrade preview; **troop gifts only to friends you share a border with** (D-023; airlifts add the second way in 2B.1); nations build and upgrade (tribes don't); headless metrics (buildings per game, gold split building vs Mobilize, game length vs 2.4) and `--no-buildings` regression | `--no-buildings` games identical to 2.4; every flow verified in the browser; nations build believably; game length change measured and reported |
| 2.6 ✅ | **Border Defense I–III → drawn walls** (D-024; first built as posts fortifying the border, D-022, replaced at the user's request the same day) — originally: fortification zones on the existing ownership/border data (no parallel map): per-tile fortification level derived from posts + ownership, wall rendering on fortified border segments by level, attack loss/speed modifiers in `attacks.ts` **and** `battle.ts` (odds stay true), post destroyed on capture, all §3.17.6 edge cases as ASCII-map tests; a generic **zone-modifier** hook that suppression (2B) plugs into; AI: where to fortify (fronts under threat), and attacking around zones / aiming at posts | Turtle wins in tribe lobbies not worse than 2.4 (24/50) — or a documented decision; frontal attacks on an L3 line cost ~1.6× the troops; walls readable at every zoom |
| 2.7 | **Naval transport + Port I–II** *(was 2.6)* — boats from any coast, routes, ETA, beachheads, recall; boat troops count toward the cap. **Builds the generic "attack from a landing tile" (beachhead attack) and landing-pocket encirclement protection that airborne assaults reuse in 2B.** Port I–II (faster boats, extra boat slots, harbour income, Marines). Port III waits for 2B/naval follow-up | Boats land and fight via the normal attack system; Port levels change boat speed/slots measurably; AI uses boats |
| 2.8 | **More maps** *(was 2.7)* — bigger maps for big lobbies; real-world maps via our own pipeline (public-domain data) and/or CC BY-SA maps; `WorkerHost`; re-check building spacing and range values on bigger maps | |
| 2.9 | **Sound & game events** *(was 2.8)* — first pass; pings & emotes; a reusable "incoming threat" warning (used by boats now, flights/missiles in 2B) | |
| 2.10 | **Phase 2 playtest & balance** *(new)* — the user plays buildings, Border Defense and boats together; tune with headless runs; check the game-length target (longer games accepted by the user, §3.17.12) | The user approves the feel; Phase 2 handoff |

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

**After the user's first 2.1 playtest:** smaller tribe names and troop numbers (tribe troops
only when zoomed in); tribes scattered at random instead of evenly (nations still evenly);
the game renamed **OpenBorder** (D-014). 40 games each, 10 nations + 100 tribes: nations
win 80/80; median Medium 13.8 min, Hard 10.3 min; 8-nation games identical to before.

Open for later: tribes don't yet react to alliances or traitors (2.2); nations don't
yet decide about alliances (2.2). *(Done in 2.2.)*

**Milestone 2.2 result (2026-10-02)** — alliances; design note GAME_DESIGN §3.14, decision
**D-018**. Requests (20 s, 30 s cooldown), 5-minute alliances renewed only by both,
traitors for 30 s (0.6× losses and faster fronts for their attackers; tribes hit
neighbouring traitors first; nations weigh traitors 2× — the user's request during the
milestone). HUD: right-click menu, K / Y / N keys, diplomacy cards, toasts, mint ally
borders, coral traitor stripes, leaderboard tags. Headless `--no-alliances` and per-game
diplomacy stats.

| Headless games | Winner | Median (longest) | Alliances / renewals / betrayals per game | Wins: turtle / expander / opportunist / aggressor | Tick avg / worst p99 |
|---|---|---|---|---|---|
| 10 nations + 100 tribes, Easy (50) | nation 50/50 | 18.5 min (32.6) — 2.1: 16.7 | 14.2 / 8.0 / 1.8 | 27 / 12 / 8 / 3 | 0.81 / 6.7 ms |
| … Medium (50) | nation 50/50 | 13.0 min (24.5) — 2.1: 12.6–13.8 | 9.1 / 1.0 / 1.3 | 20 / 13 / 10 / 7 | 0.86 / 7.9 ms |
| … Hard (50) | nation 50/50 | 10.4 min (13.7) — 2.1: 9.7–10.3 | 7.3 / 0.1 / 2.5 | 25 / 10 / 10 / 5 | 0.95 / 6.6 ms |
| 15 nations + 110 tribes, Medium, Large (20) | nation 20/20 | 16.1 min (20.5) | 15.7 / 2.9 / 2.3 | 7 / 8 / 3 / 2 | 1.6 / 12.7 ms* |
| 8 nations (100) | — | 7.6 min (14) | 6.0 / 0.1 / 1.9 | 26 / 30 / 28 / 16 | 0.73 / 6.9 ms |
| 8 nations, `--no-alliances` (100) | — | 7.1 min (15.5) | — | 34 / 24 / 30 / 12 | 0.77 / 7.0 ms |

* 7 games in parallel on the Large map (encirclement floods, see 2.0). No errors, every
game has a winner. With alliances off, games are identical to 2.1/Phase 1 (same median,
same wins). Alliances lengthen games a little (Easy most: its nations renew 8 times a
game; Hard nations almost never renew and betray most). About three of four requests are
declined: nations mostly ask stronger neighbours, who rarely need them. **Watch:** turtles
(quick to ally, never betray) win 40–54% of tribe games (2.1 Medium: 34%) — believable,
left for the playtest. Browser: every flow checked (request, accept with Y, decline, renew
with the card, let it end, expiry, break → traitor stripes/tags/toasts, alliance ends when
an ally is eliminated), clean console.

**Milestone 2.3 result (2026-10-02)** — teams; design note GAME_DESIGN §3.15, decision
**D-019** (the user's answers: alliances unchanged and always requested, across teams too;
allied teams never win together; tribes teamless; nations spawn at random, humans pick).
Start screen *Mode* Free-for-all · Teams with 2–8 teams (you and the nations dealt
round-robin); team colours (shades of a team hue); leaderboard *Teams* block and *team*
tags; teammate hover card/menu; teammate-eliminated and team-out toasts; team end card.
Headless `--teams N`.

| Headless games | Winner | Median (longest) | Leader at min 3 wins | Teammate attacks | Tick avg / worst p99 |
|---|---|---|---|---|---|
| 8 nations, 2 teams (100) | team 1: 42 · team 2: 58 | **4.7 min** (11.7) | 74% | 0 | 0.66 / 5.4 ms |
| 10 nations + 100 tribes, 2 teams, Medium (50) | 25 · 25 | 7.3 min (14.9) | 76% | 0 | 0.87 / 5.3 ms |
| 12 nations + 100 tribes, 4 teams, Medium (50) | 11 / 17 / 10 / 12 | 11.2 min (24.5) | 38% | 0 | 0.82 / 6.0 ms |
| 8 nations, free-for-all (100, regression) | — | 7.6 min (14) | 30% | — | 0.68 / 7.1 ms |

No errors; every game has a winning team; teammates never attacked each other. The
free-for-all run is identical to 2.2 (same median, same wins by personality). In 2-team
games nations never ally across teams (only two sides are left, the §3.14 rule counted by
team); with 4 teams they formed ~11 alliances a game. **Watch:** 2-team games are short and
the team ahead at minute 3 usually wins — each team starts near 50% of the land, so a
20-point swing wins. Tried: no "gang up" weights (4.7 min, no change) and an 80% team goal
(5.8 min) — neither fixes it, so the goal stays 70% like free-for-all; left for the
playtest. Browser: Teams start screen, team colours, mint teammate names/borders, Teams
block, teammate hover card and right-click menu (fixed: a teammate you didn't border showed
"Request alliance"), teammate-eliminated toast, "Team Red won the match" end card,
free-for-all unchanged; clean console.

**Milestone 2.4 result (2026-10-02)** — economy; design note GAME_DESIGN §3.16, decision
**D-020** (the user chose that **troops can be donated too**, with limits; during the
milestone they asked that conquering a player give **all** of their leftover gold, with an
animation). Income 10 + 0.8·√tiles gold per tick (tribes half, never spent); Mobilize 1 gold
per troop up to the cap (HUD: +10% of capacity per click, key M); gifts of troops (only what
fits) or gold to allies and teammates, 10 s per friend and kind; full loot with a gold
border shimmer and a rising "+gold" on the map. HUD: gold row and Mobilize button in the
command bar, *Send troops / Send gold* in an ally's or teammate's menu, gold on the hover
card, gift and loot toasts, a gold hint. Headless `--no-economy` and per-game gold stats.

| Headless games | Median (longest) | 2.3 | Leader at min 3 wins | Mobilizes / troop gifts / gold gifts per game | Nation income at min 1 / 3 / 6 | Tick avg / worst p99 |
|---|---|---|---|---|---|---|
| 8 nations (100) | 7.1 min (14.5) | 7.6 | 30% | 0.6 / 0 / 0 | 1.0k / 2.0k / 3.1k gold/s | 0.68 / 6.9 ms |
| 8 nations, `--no-economy` (100) | 7.6 min (14) — identical to 2.3 | 7.6 | 30% | — | — | 0.74 / 9.8 ms |
| 10 nations + 100 tribes, Medium (50) | 11.8 min (19.5) | 13.0 | 16% | 3.5 / 0 / 0 | 0.8k / 1.5k / 2.2k | 0.79 / 5.8 ms |
| 8 nations, 2 teams (100) | 5.0 min (11.2) | 4.7 | 75% | 0.7 / 0.2 / 0.1 | 1.0k / 2.0k / 2.3k | 0.59 / 4.5 ms |
| 10 nations + 100 tribes, 2 teams (50) | 6.9 min (21.9) | 7.3 | 62% | 4.2 / 0.8 / 0.9 | 0.8k / 1.4k / 1.7k | 0.83 / 3.7 ms |

No errors; every game has a winner; teammates never attacked each other. With the economy
off, games are identical to 2.3 (same median, same wins by personality). Wins by
personality (8 nations): turtle 34 · expander 21 · opportunist 25 · aggressor 20; with
tribes turtles win 24 of 50 (2.2: 20) — still the thing to watch. **Balance finding:** the
first AI (refill to half capacity after every attack, all-in defence, gifts to any friend)
stretched tribe lobbies from 13 to 18 min — gold made every defender harder to beat. Nations
now keep gold as a **war chest** spent right before attacking a player, and give only to
teammates and human allies (two allied nations propping each other up stalled wars):
11.6–12.1 min. Browser: gold row, Mobilize (button and M, capped at the cap), *Send gold* /
*Send troops* to a teammate with cooldowns, toasts, full loot of a tribe with the gold
border and "+1.4K" on the map; clean console.

**Milestone 2.5 result (2026-10-02)** — building framework, Housing and Factory with levels
I–III (GAME_DESIGN §3.17, "As built"); troop gifts only over a shared border (D-023).
Headless `--no-buildings` and per-game building stats.

| Headless games | Median (longest) | 2.4 | First L1 / L2 / L3 finished (games with an L3) | Builds / upgrades / captured per game | Wins | Tick avg / worst p99 |
|---|---|---|---|---|---|---|
| 8 nations, `--no-buildings` (100) | 7.1 min (14.5) — identical to 2.4 | 7.1 | — | — | turtle 34 · opp 25 · exp 21 · agg 20 (= 2.4) | 0.73 / 6.7 ms |
| 8 nations (100) | **7.5 min** (25) | 7.1 | 1:12 / 2:24 / 5:52 (69) | 15.3 / 15.5 / 5.8 | turtle 39 · opp 23 · agg 21 · exp 17 | 0.74 / 7.5 ms |
| 10 nations + 100 tribes, Medium (50) | **13.3 min** (19.5) | 11.8 | 1:16 / 2:56 / 5:13 (50) | 28.8 / 30.3 / 12.9 | turtle 19 · exp 16 · opp 13 · agg 2 | 0.91 / 6.9 ms |

No errors; every game has a winner; the buildings step costs ~0.01 ms per tick. Leader at
minute 3 wins 33% (8 nations) and 20% (tribe lobbies). Buildings lengthen games a little —
accepted by the user (longer games are fine). Turtles win 19 of 50 tribe lobbies (2.4: 24).
**Watch:** aggressors win only 2 of 50 tribe lobbies — they save least and fight most.
Browser: build menu (right-click own land / B) with prices and the spacing ring, a
construction with its progress ring, the "Housing ready" toast and +30K capacity, the
building card with the upgrade preview — clean console. The card's *Upgrade* and *Cancel*
buttons were exercised by tests but not yet clicked in the browser (the user was using the
pane): first thing to check in the 2.5 playtest.

**After the user's 2.5 playtest (same day):** "plays well, pricing is good". Asked for: a
build bar in the bottom HUD with buildings that stick to the mouse until placed (like
OpenFront) — built, replacing the right-click *Build here* list and key B; revamped icons
(shared SVG art in `client/icons.ts`, round badges, gold level dots, bigger at 18–40 px);
and **captured buildings adopted by the taker at their level** (was: one level lower).
Headless after it — 8 nations (100): median 7.9 min, wins turtle 28 · opp 27 · exp 24 ·
agg 21 (more even than before), 15 buildings captured per game; 10 nations + 100 tribes
(50): 13.4 min, turtle 25 · exp 12 · opp 8 · agg 5, first L3 at 5:26. Browser: bar, ghost
(green on your land, red elsewhere), placing, Esc and right-click to put it back, card
*Upgrade* and *Cancel* (refund) — all clicked; clean console.


**Milestone 2.6 result (2026-10-02)** — Border Defense as **walls drawn point by point**
(GAME_DESIGN §3.17.6, D-024). The first version — a post whose circle fortified the owner's
border, the border drawn as a wall in the shader (D-022) — was built and verified (tests;
headless: 8 nations 8.5 min, turtles 28; tribe lobbies 14.5 min, turtles 16/50; a frontal
attack on a level-III line needed 1.55× the troops) and shown in the browser; the user then
asked for Clash of Clans-style walls placed A, B, C … that enemies push through, and chose:
walls replace posts, hard tiles, anywhere on your land.

| Headless games | Median (longest) | 2.5 | Walls / tiles / upgrades / tiles broken per game | Wins | Tick avg / worst p99 |
|---|---|---|---|---|---|
| 8 nations, walls off (`maxWalls` 0) (100) | 7.9 min (15.4) — identical to 2.5 | 7.9 | — | turtle 28 · opp 27 · exp 24 · agg 21 (= 2.5) | 0.85 / 7.6 ms |
| 8 nations (100) | **7.7 min** (16.6) | 7.9 | 29.7 / 565 / 7.3 / 461 | turtle 33 · opp 23 · agg 22 · exp 22 | 0.82 / 6.8 ms |
| 10 nations + 100 tribes, Medium, walls off (50) | 13.4 min (21.6) — identical to 2.5 | 13.4 | — | turtle 25 · exp 12 · opp 8 · agg 5 (= 2.5) | 0.93 / 6.7 ms |
| 10 nations + 100 tribes, Medium (50) | **12.9 min** (20.7) | 13.4 | 32.6 / 604 / 7.6 / 531 | exp 17 · opp 17 · turtle 13 · agg 3 | 1.15 / 9.0 ms |

No errors; every game has a winner. Turtles win 13 of 50 tribe lobbies (2.4: 24, 2.5: 25 —
the "done when" was "not worse"); in 8-nation games they win 33 (2.4: 34). Most walls
are eventually broken through (enemies push). Hold times measured (army 3× the defender):
open border 0.6 s, Palisade 2 s, Fortress Wall 5.2 s. **Watch:** aggressors win only 3/50
tribe lobbies (2.5: 5) — 2.10 balance. Browser: Wall tool in the build bar (600/tile),
points A, B, C with the line following the mouse and "35 tiles · 21K", right-click to
build, dashed construction with a progress ring, the Palisade (stakes), the wall card
(Upgrade to Stone Wall 60K — red until affordable, then clicked), Stone Wall with towers and
the "Stone Wall ready" toast; nations drew their own Palisades behind their fronts; clean
console. Not seen in the browser yet: an enemy breaking a gap (covered by tests).

## Phase 2B — Air & strategic warfare *(PLANNED)*

Design: GAME_DESIGN §3.17.7–3.17.8. **Placement (user, 2026-10-02): after Phase 2, before
multiplayer** — the solo game gets its full depth first; Phase 3 then carries these
systems as ordinary commands (D-006). I had recommended after multiplayer; the cost of
this order is that multiplayer's risks (determinism across browsers, server load) are
tested later, on more systems — Phase 3's determinism tests must cover flights and
buildings from the start.

**Bots first (user, 2026-10-02):** each milestone builds the simulation and the **nation
AI** before the human controls. Nations place airports and SAMs and fly missions in
headless bot-only games (metrics: flights per game, interceptions, assault success, game
length) and in a spectated browser game; only when that looks right do we add the
player's card, targeting and warnings. Bugs and balance problems show up in hundreds of
bot games before anyone has to play them.

| # | Milestone | Needs | Done when |
|---|---|---|---|
| 2B.0 | **Flight foundation** — `world.flights` (straight-line flights with analytic positions, deterministic), launch/arrival/interception events in frames, flight rendering (glyph, dotted route, ETA), range rings in action mode, incoming-flight chips + warning (2.9), cooldown/charge bookkeeping on buildings | 2.5 range module + building model | A test flight launches, flies, arrives and renders; same seed ⇒ same hash |
| 2B.1 | **Airport I + airlift** — Airport building I, airlift to allies/teammates (capacity, cooldown, overflow flies back) — the only way to send troops to a friend you don't border (D-023) | 2B.0, alliances (2.2), economy gifts (2.4) | Reinforce a distant ally in the browser; nations airlift to a teammate losing a war |
| 2B.2 | **SAM I–III** — interceptors, reload, radius rings, air-defense view, hostile-airspace rule, SAM destruction; AI SAM placement (cover Housing/Factory/Airports) | 2B.0 (shoots airlifts over hostile airspace from day one) | Airlifts lose planes over hostile SAMs exactly per the rule; no stacking bonuses |
| 2B.3 | **Airport II airborne assault** — hostile landing, beachhead attack (from 2.7), ×1.25 airborne losses, landing-pocket protection, SAM and Defense Line III flak interception; AI: assault busy/depleted targets, bypass fortified borders | 2B.1, 2B.2, 2.6, 2.7 | Assaults open a front and then play exactly like ground attacks; no "teleport army" meta in headless games |
| 2B.4 | **Airport III air strikes** — fighter wings, building damage (−1 level, disabled), point suppression (zone-modifier hook from 2.6), escorts; AI: strike SAMs/posts before assaults, strike prime targets | 2B.3 | Combined arms works: strike → suppress → assault → capture |
| 2B.5 | **Missile Silo I–III** — strike missile, bunker buster, strategic warhead (scorched land), SAM II/III missile interception, Factory III war production; AI: silos in long games, warheads vs runaway leaders | 2B.0, 2B.2 | A late-game leader can be checked by missiles; SAM III is the only warhead counter |
| 2B.6 | **Port III Naval Base + strategic balance pass** — coastal fortification; warship patrol only if boats proved fun (feature matrix); full balance and AI pass across all buildings | 2.7, 2B.5 | Playtest approval; Phase 2B handoff |

**Dependency map** (what must exist first):

```
2.5 building framework + range module ─┬─▶ 2.6 Border Defense ─(zone-modifier hook)──┐
   (Housing, Factory prove 3 levels)   ├─▶ 2.7 boats + beachhead attack + Port I–II ─┤
                                       └─▶ 2B.0 flights ─▶ 2B.1 Airport I ─▶ 2B.2 SAM ─┼─▶ 2B.3 Airport II
                                                                     2B.2 ─▶ 2B.5 Silo  └─▶ 2B.4 Airport III
2.2 alliances + 2.4 gifts ─▶ 2B.1 airlift        Phase 3 multiplayer carries all of it as commands
```

## Phase 3 — Multiplayer

Authoritative Node server (hybrid lockstep, `ARCHITECTURE.md` §7), lobbies (create /
join by link / public), player names, reconnect via snapshots, spectators, server
browser / simple matchmaking, command validation & rate limits, desync detection +
resync, cross-browser determinism tests, online teams (team games with bots come in 2.3).

**Buildings and air/strategic systems online — server authoritative**
*(PLANNED, added 2026-10-02).* Under D-006 the server runs the same simulation, so every
outcome below is computed by it, never claimed by a client. Clients only *request*:
`build`, `upgrade`, `cancelBuild`, and later `airlift`, `airAssault`, `airStrike`,
`launchMissile`. Work items: server-side validation and rate limits for these commands
(gold, placement, spacing, ownership, level, cooldowns, range, valid targets); buildings,
flights, cooldowns and suppression timers in snapshots (reconnect/spectate); the derived
fortification field rebuilt from snapshot data, never sent; determinism tests that cover
construction, capture, flights, SAM interception and missile damage across browsers;
hashes include buildings and flights. Nothing about costs, damage, interception,
transported troops, ownership changes or victory is ever taken from a client.

## Phase 4 — Polish

UI and map animation pass, sound design, onboarding/tutorial, responsive layout and
**mobile controls**, accessibility (colorblind theme, contrast, reduced motion,
keyboard), settings & keybinds, performance on low-end devices, loading and error
handling, game statistics and post-game results, replays.

**Building & warfare UI polish pass** *(PLANNED, added 2026-10-02)*: final building art for
all 21 tiers, construction and upgrade animations, aircraft and missile animations, SAM
coverage and Airport/Silo range views, Border Defense wall art per level, incoming-attack
warnings (sound + visual), upgrade previews and ability descriptions, mobile versions of
the building card and target selection. Same rule as everywhere: the map stays the
primary interface; nothing permanent is added to the screen.

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
| City (+max troops) | **Housing** I–III | — | 2.5 | M | Planned 2026-10-02 (§3.17) |
| Defense Post | **Border Defense** I–III: fortified border zones drawn as walls | — | 2.6 | H | Planned (D-022) |
| Port | **Port** I–II (2.7), III (2B.6) | — | 2.7 / 2B | M | |
| Factory + trains/railroads | **Factory** I–III: plain gold income + Mobilize discount (no trains) | — | 2.5 | M | Trains stay out (opaque) |
| Structure levels/upgrades | **Exactly 3 named levels**, level = health | — | 2.5 | M | Planned (D-021) |
| Transport ships | Same + route/ETA preview | — | 2.7 | H | Water pathfinding; builds the beachhead attack |
| Trade ships | Maybe | — | P3 | M | Depends on economy model |
| Warships & naval combat | Naval Base patrol (Port III) | — | 2B.6+ | H | Only if transports are fun |
| Silos, SAMs | **Missile Silo** I–III (conventional missiles, one strategic warhead at III), **SAM** I–III | — | 2B | VH | User's direction 2026-10-02 (D-021) replaces "not planned" |
| Atom/Hydrogen/MIRV, fallout | Only the Silo III strategic warhead (scorched land, 60 s) | — | 2B.5 | H | No MIRV |
| *(new)* Airports & aircraft | **Airport** I–III: airlift, airborne assault, air strikes | — | 2B | VH | Not in OpenFront; biggest risk to the feel (§3.17.3) |
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

**Added 2026-10-02 with the building/air plan (GAME_DESIGN §3.17.3):** buildings shifting
the game from the map to menus; defensive stacking (Border Defense + SAM + Housing)
strengthening the turtle meta; airborne assaults weakening geography; L3 assets never
appearing in our 7–13 min games (or games growing much longer); icon clutter with 126
players; bot complexity (building decisions belong in their own `ai/` module, not in the
763-line `bot.ts`). Each milestone's "done when" measures the relevant one.
