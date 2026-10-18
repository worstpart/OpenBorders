# Roadmap

> Each phase ends with something we can run, test and judge. We move on only when the
> current phase is genuinely solid. Status markers: ✅ done · 🟡 in progress · ⬜ not started.

| Phase | Goal | Status |
|---|---|---|
| **0 — Research** | Understand OpenFront; design our architecture and first slice | ✅ |
| **1 — Playable prototype** | Prove the core loop is fun: spawn → expand → fight bots → win/lose | ✅ (tag `phase-1`) |
| **2 — Gameplay depth** | Big lobbies, Tribes & Nations, alliances, teams, economy, then buildings (3 levels), walls (Border Defense), naval, trade, more maps, alerts & pings | ✅ (tag `phase-2`) |
| **2B — Air & strategic warfare** *(placement chosen by the user 2026-10-02)* | Flights, Airports I–III, SAMs I–III, Missile Silos I–III, Port III — after Phase 2, **before** multiplayer; built bots-first (D-021); the user's icon pack as art (2B.0b, D-028) | ✅ 2B.0 – 2B.6, approved by the user's playtest 2026-10-16 (tag `phase-2b` on 09abcc4, the build they played); its fixes (D-033) right after |
| **3 — Multiplayer** | Hybrid authoritative server (D-006) on a cloud host from the start (D-034), lobby links + public lobbies (D-035), bots fill (D-036), reconnects, spectators | 🟡 3.0 snapshots ✅, 3.1 server on Railway ✅ (https://openborders-production.up.railway.app), 3.2 names + ready ✅, 3.3 validation + limits ✅, 3.4 public lobbies ✅, 3.5 repair + rejoin + spectators ✅ (live); 3.6 online feel ✅ (live); 3.7 accounts & profiles ✅ (live; Google sign-in ready but off — `docs/ACCOUNTS_SETUP.md`); 3.8 playtest with friends + hosting hardening next — handoff `PHASE_3_AFTER_3.7_HANDOFF.md` |
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

## Phase 2 — Gameplay depth ✅

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
| 2.7 ✅ | **Naval transport + Port I–II** *(was 2.6)* — boats from any coast, routes, ETA, beachheads, recall; boat troops count toward the cap. **Builds the generic "attack from a landing tile" (beachhead attack) and landing-pocket encirclement protection that airborne assaults reuse in 2B.** Port I–II (faster boats, extra boat slots, harbour income, Marines). Port III waits for 2B/naval follow-up | Boats land and fight via the normal attack system; Port levels change boat speed/slots measurably; AI uses boats |
| 2.8 ✅ | **Trade ships + more maps** *(was 2.7)* — **trade ships** between players' Ports (the user's request at the 2.8 start, D-026, GAME_DESIGN §3.19); bigger and more varied generated maps for big lobbies; `WorkerHost`; re-check building spacing and range values on bigger maps. *Real-world maps parked (D-026, see "Parked" below)* | Trade ships pay both sides and show on the map; big maps run within budget |
| 2.9 ✅ | **Sound & game events** *(was 2.8)* — first pass; pings & emotes; a reusable "incoming threat" warning (used by boats now, flights/missiles in 2B). *As built (D-027, GAME_DESIGN §3.20): the user chose alert sounds only (synthesized) and emojis + map pings; nations act on friends' pings, ping human friends and answer emojis* | Alerts, pings and emojis verified in the browser; bots-only games unchanged |
| 2.10 ✅ | **Phase 2 playtest & balance** *(new)* — the user plays buildings, Border Defense and boats together; tune with headless runs; check the game-length target (longer games accepted by the user, §3.17.12) | The user approves the feel; Phase 2 handoff |

**Milestone 2.9 result (2026-10-06).** Alert sounds, synthesized in the browser, with
volume and mute in the pause menu — retuned after the user played it (attack and ping
sounds were constant and spammable): a subtle "attacked" sound once per attacker (quiet 30
s), the boat horn per enemy boat, alliance asks/renewals, and any betrayal (sound + toast
for everyone); pings and emojis silent. The reusable incoming-threat list (chips, red
landing rings with the countdown, edge arrows, horn); map pings (right-click or **G**) seen by allies and
teammates; 14 emojis to a player or everyone. Nations act on friends' pings (×3 target
preference, aimed at the ping), ping their human friends and answer emojis. Headless:
bots-only games are **identical to 2.8** (18 of 18 games, 8 nations + 30 tribes, same
winners and lengths) — everything new needs a person. 346 tests (+30). Browser: every
alert fired (checked through the dev hook's sound log), pings via menu and G, emoji
replies from a nation, edge arrow for an off-screen boat, no console errors.

**Milestone 2.10 result (2026-10-06) — Phase 2 complete (tag `phase-2`).** The user played
Phase 2 as a whole (buildings, walls, boats, trade, alerts): *"I really like the way it's
playing and feels. Everything is looking great."* — approved with **no balance changes**.
Baseline for Phase 2B (same code as 2.9; headless, hard nations):

| Headless games | Median (longest) | Wins | First L3 building (median, games with one) | Walls / trade gold per game | Tick avg / worst p99 |
|---|---|---|---|---|---|
| 8 nations, Continent (60) | **8.9 min** (24.5) | exp 21 · turtle 20 · opp 14 · agg 5 | 7.6 min (32/60) | 30 / 2.0M | 1.3 / 12.5 ms* |
| 8 nations, Islands (40) | **20.5 min** (35.9) | turtle 13 · exp 10 · opp 9 · agg 8 | 8.8 min (40/40) | 47 / 7.9M | 0.7 / 7.3 ms |
| 8 nations, Two lands (40) | **12.9 min** (24.0) | agg 14 · opp 10 · exp 9 · turtle 7 | 7.0 min (30/40) | 27 / 4.8M | 0.9 / 11.0 ms |
| 10 nations + 100 tribes, Continent (30) | **11.8 min** (18.3) | turtle 16 · exp 7 · opp 5 · agg 2 | 6.8 min (29/30) | 37 / 2.4M | 1.5 / 8.5 ms |
| 8 nations in 2 teams, Islands (30) | **6.2 min** (15.5) | team 1: 13 · team 2: 17 | — (1/30) | 19 / 1.1M | 0.7 / 5.0 ms |

\* the machine was busy (a dev server starting, other chats' servers). No errors, no
timeouts, every game has a winner. **Carried into Phase 2B (balance pass 2B.6):**
aggressors win few Continent games (5/60; 2/30 in tribe lobbies); Islands free-for-alls
sit at the top of the accepted 15–20 min; team games end fast (combined land reaches the
goal in ~6 min) — so L3 buildings rarely appear there. Air units will change all three;
measure again with them rather than tune now.

**Parked — real-world maps (D-026).** The user said "no real maps yet" at the 2.8 start.
For when they are scheduled: the user's picks are **World, Europe, North America, East
Asia**, with **real country names** for the nations, each starting at its real location
(tribes random; names only, no flags). Source still to decide: our own pipeline from
public-domain elevation data (NOAA ETOPO1 — my recommendation: no licence ties) or
OpenFront's CC BY-SA maps (credit + share-alike for our map files).

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

**User report (same day): "nation bots aren't placing buildings, just walls".** Two causes: zoomed
out, other players' level I–II buildings were hidden (since 2.5) while walls were always
drawn; and a nation's first wall (~15k) was affordable before its first Housing (40k), so
every nation walled first. Fixed: far-zoom buildings are small dots ringed in the owner's
colour (clickable); nations build walls only after their first Housing or Factory (unless
under attack), wall worth 0.10 / 0.18 / 0.26. Every nation now starts with a Housing at
~1:12, walls from ~1:20. Headless after the fix — 8 nations (100): 7.7 min, turtle 35 · exp
28 · agg 19 · opp 18; 10 nations + 100 tribes (50): 12.6 min, turtle 19 · exp 17 · opp 9 ·
agg 5; ~31 walls per game.

**Milestone 2.7 result (2026-10-02)** — islands, boats, beachheads and Ports I–II (GAME_DESIGN
§3.2 and §3.18, D-025). Asked at the start: walls "feel good, move on"; and how boats get
something to cross — the user chose **islands always** (the generated map is now a continent
plus 5–7 islands, 50% land; `islands: false` makes the old map exactly).

| Headless games | Median (longest) | 2.6 | Boats per game: settling / attacking / landed as beachheads / Ports built + upgraded | Wins | Tick avg / worst p99 |
|---|---|---|---|---|---|
| 8 nations, `--no-boats --continent` (100) | 7.7 min — identical to 2.6 | 7.7 | — | turtle 35 · exp 28 · agg 19 · opp 18 (= 2.6) | — |
| 8 nations (100) | **8.4 min** (24.5) | 7.7 | 13.1 / 6.9 / 18.0 / 8.2 + 4.3 | opp 29 · turtle 26 · exp 25 · agg 20 | 0.82 / 9.0 ms |
| 10 nations + 100 tribes, Medium, `--no-boats --continent` (50) | 12.6 min — identical to 2.6 | 12.6 | — | turtle 19 · exp 17 · opp 9 · agg 5 (= 2.6) | 0.97 / 7.7 ms |
| 10 nations + 100 tribes, Medium (50) | **13.4 min** (23.5) | 12.6 | 12.2 / 19.0 / 27.9 / 10.0 + 6.9 | exp 20 · turtle 20 · opp 7 · agg 3 | 0.89 / 7.3 ms |

No errors, no timeouts, every game has a winner; no boat command was ever rejected (the
~0.6 rejections per game are the old alliance-timing ones). Games are a little longer (the
islands are settled late and crossings take time); wins are more even in 8-nation games
(turtles 26, 2.6: 35). The worst single tick (~90–110 ms) is each worker's first bot think,
when the per-map sea data is built once (the browser builds it at map load). Long route
searches take ~10 ms (weighted A*). Browser (own tab, port 5181): hover over another island
→ "Click: ⛵ boat … lands in N s" with a dashed route and landing ring; inland start → "No
boat: you have no coast on that sea"; boat sent, landed, beachhead chip "⛵ Settling";
a 989-tile crossing (99 s) drawn round the north coast, recalled with ↩ ("Home in 4 s",
troops back); Port ghost red inland and green on the coast, placed, built, crossings ×1.5
faster (2.5 s → 1.7 s), Port card with the Naval Port upgrade; an enemy boat → red toast
"⛵ Grenholm's boat is heading for your coast", red countdown chip and route; nations took
an island by boat, built Ports and eliminated me with a 25.8K landing. Clean console.
Found and fixed in the browser: neutral land on another island was offered as a land
expansion; the attack chips hid behind the command bar; route search hitches.

**Milestone 2.8 result (2026-10-06)** — trade ships and more maps (GAME_DESIGN §3.19 and
§3.2, D-026). Asked at the start how boats feel: "sending ships to invade islands feels
good" — and the user asked for OpenFront-style **trade ships** (built here) with warship
piracy later (2B.6); real-world maps: **"no real maps yet"** (parked above, with their picks).
Built: trade ships; map types **Continent / Islands / Two lands**, sizes **Normal / Large /
Huge**, "Map #N" and 🎲 New map; maps generated in a worker; **`WorkerHost`** (the game's
simulation in a Web Worker); sea routes guided by a coarse distance field (big maps); nations'
sea reach grows with the map (Large ×1.4, Huge ×2).

| Headless games | Median (longest) | 2.7 | Trade trips / gold per game (both sides) | Wins | Tick avg / worst p99 |
|---|---|---|---|---|---|
| 8 nations, `--no-boats --continent` (100) | 7.7 min — identical to 2.6/2.7 | 7.7 | — | turtle 35 · exp 28 · agg 19 · opp 18 (=) | — |
| 8 nations (100) | **8.5 min** (24.5) | 8.4 | 191 / 1.9M (~22% of all gold) | turtle 31 · exp 29 · opp 27 · agg 13 | 0.94 / 9.0 ms |
| 10 nations + 100 tribes, Medium (50) | **12.7 min** (20.2) | 13.4 | 334 / 3.2M | turtle 19 · exp 16 · opp 10 · agg 5 | 1.04 / 7.0 ms |
| 8 nations, **Islands** (50) | **20.5 min** (35.9) | — | 771 / 7.5M | opp 14 · turtle 13 · exp 12 · agg 11 | 0.57 / 6.6 ms |
| 8 nations, **Two lands** (50) | **14.7 min** (24.0) | — | 485 / 5.0M | agg 17 · opp 12 · exp 11 · turtle 10 | 0.63 / 7.6 ms |
| 15 nations + 110 tribes, **Large** (30) | **17.0 min** (25.1) | — | 799 / 8.5M | turtle 14 · exp 7 · opp 7 · agg 2 | 2.1 / 17 ms* |
| 25 nations + 100 tribes, **Huge** (4, 2 at a time) | **25.2 min** (34.7) | — | — | — | **2.8 / 18 ms** |

\* 7 games in parallel. No errors, no timeouts, every game has a winner (also 14 Huge games
run 7 at a time: median 20.2 min). The worst ticks (80–130 ms) are each worker's first bot
think (per-map sea data, built once) — in the browser that work happens at map load; a
first-time trade route on Huge takes up to ~40 ms (then cached). Sea routes: a coarse
block-distance estimate plus an exact same-sea check took Huge-map searches from median 9.9
/ p95 162 / max 218 ms to 3.6 / 17.6 / 25 ms. **Islands games run long (20.5 min, every
war is a landing)** — for 2.10 balance. Browser (own tab, port 5178): trade ships sail
between nations' Ports (small hulls with a gold dot and a light rim — enlarged after the first
look: they were specks on dark water); my Port's card "A trade ship every 20 s · Trades with
7 other Ports · Your trade so far: 2.8K gold", Naval Port upgrade "Trade ships every 10 s";
"+1.4K" floats up over my Port when trade pays; the start screen's Map / Size / Map #N / 🎲
rows; Islands, Two lands and Huge maps generate while the card says "Generating map…" (the
card used to vanish — fixed); a game runs from `simWorker.ts` at 10× with a clean console;
Huge with 126 players at 4×: 165 fps, 1.5 ms CPU per frame, ticks 5.9 ms avg in the worker;
a boat preview across 900 tiles of a Huge map ("lands in 86 s") with its route drawn.
Range re-check: building spacing (8) and Port range (30) are about local density, so they
stay; boat speed stays (crossings on Huge take longer — that is the map's size); the trade
cap (6,000 at 560 tiles) keeps Huge routes from overpaying; nations' sea reach now scales.

## Phase 2B — Air & strategic warfare ✅

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
| 2B.0 ✅ | **Flight foundation** — `world.flights` (straight-line flights with analytic positions, deterministic), launch/arrival/interception events in frames, flight rendering (glyph, dotted route, ETA), range rings in action mode, incoming-flight chips + warning (2.9), cooldown/charge bookkeeping on buildings | 2.5 range module + building model | A test flight launches, flies, arrives and renders; same seed ⇒ same hash |
| 2B.0b ✅ | **Icon pack art** (D-028, the user's request during 2B.0) — the user's `openborder_icon_pack_final` becomes the art: buildings Housing / Factory / Port / Airport and vehicles (troop boats, trade ships, airplanes, helicopters), eras WW1 → WW2 → Modern = levels I → III. Crop the baked-in level captions, trim and downscale into `src/client/assets`; sprite on an owner-colour ring + level pips on the map (far zoom keeps dots), sprites in the build bar and building cards; boats/trade ships by Port level, flights by Airport level, helicopters for airborne assaults (2B.3); mirror by heading. SAM, Silo, walls, warships, missiles keep our drawings until more art arrives. First confirm the art's provenance (D-001) | 2B.0, 2.5 icons | Every Housing, Factory, Port, boat, trade ship and flight shows the pack in the browser at every zoom, owner and level readable; bundle size and fps checked; user approves the look |
| 2B.1 ✅ | **Airport I + airlift** — Airport building I, airlift to allies/teammates (capacity, cooldown, overflow flies back) — the only way to send troops to a friend you don't border (D-023) | 2B.0, alliances (2.2), economy gifts (2.4) | Reinforce a distant ally in the browser; nations airlift to a teammate losing a war |
| 2B.2 ✅ | **SAM I–III** — interceptors, reload, radius rings, air-defense view, hostile-airspace rule, SAM destruction; AI SAM placement (cover Housing/Factory/Airports) | 2B.0 (shoots airlifts over hostile airspace from day one) | Airlifts lose planes over hostile SAMs exactly per the rule; no stacking bonuses |
| 2B.3 ✅ | **Airport II airborne assault** — hostile landing, beachhead attack (from 2.7), ×1.25 airborne losses, landing-pocket protection, SAM and Defense Line III flak interception; AI: assault busy/depleted targets, bypass fortified borders | 2B.1, 2B.2, 2.6, 2.7 | Assaults open a front and then play exactly like ground attacks; no "teleport army" meta in headless games |
| 2B.4 ✅ | **Airport III air strikes** — fighter wings, building damage (−1 level, disabled), point suppression (zone-modifier hook from 2.6), escorts; AI: strike SAMs/posts before assaults, strike prime targets | 2B.3 | Combined arms works: strike → suppress → assault → capture |
| 2B.5 ✅ | **Missile Silo I–III** — strike missile, bunker buster, strategic warhead (scorched land), SAM II/III missile interception, Factory III war production; AI: silos in long games, warheads vs runaway leaders | 2B.0, 2B.2 | A late-game leader can be checked by missiles; SAM III is the only warhead counter |
| 2B.6 ✅ | **Port III Naval Base + strategic balance pass** — coastal fortification; warship patrol (boats proved fun — user, 2.8 start); **warships capture non-allied trade ships** (the ship sails to the captor's nearest Port and its cargo is theirs; allies' and teammates' ships immune — D-026); full balance and AI pass across all buildings | 2.7, 2.8 trade, 2B.5 | Playtest approval; Phase 2B handoff |

**Milestone 2B.0 result (2026-10-06)** — the flight foundation (ARCHITECTURE §5.7 "as built").
Built: `world.flights` with positions as a pure function of the tick (straight line, speed
by kind of plane: transports 2, fighters 3, missiles 3 tiles/tick), launch / arrival /
interception / loss events, frames carry flights, troops aboard count as field troops,
`shootDown` (planes take their share of the troops), charges (reload one at a time) and
mission cooldowns on buildings; client: aircraft glyph, dotted line and ETA, hostile flights
in the incoming-threat list (chip "X's test flight arrives in 7 s", red ring and countdown,
edge arrows, a toast) with the horn once per sender per 30 s. **Bots first:** nothing for
nations to fly until Airports exist (2B.1), so flights are launched with a **debug
`testFlight` command** (empty transports, no effect on arrival), accepted only in dev
builds (`rules.flights.testFlights`). **Regression:** 18 bots-only games (6 Continent, 4
tribe lobbies, 4 Islands, 4 Two lands with teams) compared seed by seed against a worktree
of `phase-2`: **every tick's state hash identical** (flights and charges enter the hash
only once used). Headless 14 Continent games: median 8.9 min, no errors. Tests: 365 (19
new: position math, events, rejections, interception, elimination/game over, charges,
same seed ⇒ same hash with flights). Browser (own tab, port 5176): my flight to a nation
and a nation's flight at me (sent with `sendAs`) — planes in the owner's colour along
dotted lines, my ETA ring, the red incoming line, ring and "✈ 7 s", the chip and the
toast, one horn; both landed, chips cleared, clean console. The glyph was enlarged after the
first look (it was a speck at normal zoom). Not done here: range rings in action mode (no
action exists before the Airport card, 2B.1). During 2B.0 the user asked for their icon pack
as the game's art → milestone 2B.0b (D-028).

**Milestone 2B.0b result (2026-10-06)** — built; **the user approved the look** ("looks
good"). The user confirmed the pack is their own (made/generated by them — D-001 satisfied)
and asked for the planes' national markings to go. `tools/iconPack.mjs` (plain `node`, no
packages: `tools/png.mjs` reads/writes PNGs with Node's zlib) turns the pack into 24
sprites in `src/client/assets/icons/` (268 KB; buildings 96 px, vehicles 80 px on the
long side): **15 of 24** PNGs still had the "LEVEL n / ERA" caption (not 4) — cut out by
its exact colour; under it the bottom corner of the ground tile (buildings, airports) and
the hull (troop boats, first trade ship) were rebuilt by continuing their edges; roundels,
stars and the tricolour rudder painted over (WW1 and WW2 planes). `client/sprites.ts` loads
each image once and keeps pre-shrunk copies per drawn size. Map: building badges show the
sprite (max size 40 → 48 px so the art reads; far zoom keeps the dots), troop boats and trade
ships are sprites on an oval in the owner's colour (era of the Port they sailed from,
fixed at first sight), flights are planes over a shadow in the owner's colour (era of their
Airport — `FlightSnapshot.source`, new; test flights level I); vehicles are mirrored by
heading. HUD: build bar tiles (30 px, greyed when unaffordable) and building cards (44 px)
show the sprite; walls keep their drawings. Checked in the browser (own tab, 800×600,
magnified): Housing/Factory/Port at levels I–II, trade ships, a WW1 troop boat, two test
flights crossing (one mirrored), the Port card, far zoom (ships shrink to 12–16 px so the
sea isn't crowded), clean console; perf overlay 0.5 ms CPU per frame with 20 trade ships on
screen; build OK (JS bundle unchanged, sprites are separate cached files). Tests: 369 (4 new).
The user also asked me to **make art in the same style** for what the pack lacks (SAM,
Missile Silo, walls, warships, missiles) — placed with each thing's own milestone (SAM +
walls in 2B.2, Silo + missiles in 2B.5, warships in 2B.6); how to make it is the open
question (D-028). **Answered during 2B.1:** the user sent a second sheet in the same style
(SAM, wall, Missile Silo I–III and seven missiles) — cut out by the same tool (below).

**Milestone 2B.1 result (2026-10-07)** — Airport I and the airlift (GAME_DESIGN §3.17.7
"as built", ARCHITECTURE §5.7). **Rules:** `airport` building (120k, 15 s, **plains only** —
new placement `plains`, "an airport needs flat land"), level I only for now (II–III with
2B.3–2B.4; the card says so). Command `airlift {buildingId, tile, percentBp}`: the send share
of your home troops, capped at **10% of your troop capacity**, flies as 4 transports (2
tiles/tick) to any land of a living ally or teammate within **250 km**; the Airport then
cools down **30 s** (mission slot 0). On arrival the friend takes what fits under their
capacity, the rest flies back as a `return` flight to the owner's home troops (also all of
it if the friend died or stopped being a friend). Event `airliftDelivered`. Switch
`rules.flights.enabled` (headless `--no-flights`). **Nations:** airlift to a teammate or
human ally losing a war (more troops attacking them than they have at home) that they
don't border, when their Airport is ready and the friend is in range — the same gift rule
as over a border; they build an Airport (one) only while such a friend is in need **and
within reach** of their land. The first version valued an Airport for any distant friend:
3–7 Airports per team game, 0.2 airlifts, games 6.1 → 9.2 min median; the debug trace
showed the friends in need were out of range. Now: Twin-lands teams 0.3 Airports/game,
median 6.0 min (6.1 without flights); Continent teams 0.4, median 5.1 (5.4); no rejected
commands (headless now records rejection reasons). Airlifts by nations stay rare (0.1 per
game) — teammates mostly border each other or are far apart; the Airport is mainly a human
tool. **Regression:** the 18 seed-by-seed games with flights off are identical to 2B.0b
every tick; with flights on, free-for-all games are identical too (nations only build
Airports for teammates/human allies) and team games differ (`tools/hashDigest.mjs` now
takes rule overrides). **Client:** Airport in the build bar (painted art), the Airport card
with **"✈ Airlift troops — up to N"** (or "ready in N s"), then aiming: the Airport's range
ring, a green line, landing ring and "✈ 2.03K · 10 s" over a friend's land in range, red
with the reason elsewhere; click sends (the send % sets the share), right-click/Esc cancels;
toasts for the sender ("Airlift landed: … joined X", overflow flying back), the receiver
("X is airlifting … to you", "X's airlift landed: +…"); a friend's airlift to you is drawn
like your own flights; flights carrying troops show the troops. **Art:** the user's second
sheet (`openborder_icon_pack_final/sheets/`) → 16 more sprites (`sam-1..3`, `wall-1..3`,
`silo-1..3`, `missile-1..3`, `cruiseMissile`, `airToAirMissile`, `airToGroundMissile`,
`icbm`); transparent background, so each is cut out by its box and the same caption
cleanup runs (first pack byte-identical). Walls now use their art in the build bar and wall
cards; SAM/Silo/missile art waits for 2B.2/2B.5. Browser (own tab, Teams on Islands): gold
gifted by teammates (`sendAs`), Airport placed from the build bar, built, card, aimed (ring,
line, ETA), sent 2.03K to a teammate 185 km away, plane flew and landed, both toasts, card
cooldown "ready in 20 s", clean console. Tests: 376 (7 new airlift tests, sprites).

**Milestone 2B.2 result (2026-10-07)** — SAM I–III (GAME_DESIGN §3.17.7 "as built",
ARCHITECTURE §5.7). **Rules:** `sam` building (80k / +180k / +400k, 10 / 15 / 25 s, any land,
adopted on capture), radius 25 / 35 / 45 km, interceptors 1 / 2 / 3, reload 10 / 8 / 6 s each
(one at a time); only with `rules.flights.enabled`. **The one rule:** every tick, before
arrivals, each flight (id order) meets the SAMs (id order) of everyone who isn't its owner's
friend — target and third players alike; a working SAM with a ready interceptor whose radius
holds the flight's tile fires once, destroying one plane and its share of the troops. Decided
here: **at most one shot per SAM per tick** (shots come staggered, ~0.1 s apart; it can't
change who wins a saturation — a flight spends 10+ ticks in any ring); a SAM being upgraded
fires at its old level. Missile interception (II) and the warhead + early warning (III) wait
for missiles (2B.5); the upgrade preview marks them "Later:". **Nations:** SAMs only under an
air threat (a non-friend's working Airport within its range + 60 km of their Housing / Factory
/ Airport), worth 0.12 × capacity per interceptor × the share of those buildings' levels it
covers, placed among them, at most 2, upgraded by the same measure; their airlifts land where
the route meets the fewest ready interceptors, and don't fly when every route would lose every
plane. **Headless** (60 games each, same settings on the 2B.1 commit for comparison): Twin
lands teams 0.3 SAMs/game, median 6.6 min (2B.1: 6.6); Continent teams 0.2, median 5.1 (5.1);
**0 planes shot down** — nations' airlifts never cross a hostile SAM yet; SAMs start to matter
for bots with airborne assaults (2B.3). Today they are mostly a human tool against human
airlifts, and a deterrent the nations answer. **Regression:** the 18 seed-by-seed games are
identical to 2B.1 with flights off *and* on. **Client:** SAM in the build bar (the user's
`sam-1..3` art); the command panel grew 580 → 620 px with slightly more compact tiles to fit
six buildings, the wall and the new ◎ air defence toggle, and the placing / aiming instruction
moved to its own line above the tiles (it had been squeezed to nothing); SAM card with
interceptors (filled = ready) and "next in N s"; radius ring when its card is open, every SAM's
ring in the air defence view (key **V**), when placing a SAM (plus the ghost's 25 km reach) and
the hostile ones while aiming an airlift, with "⚠ SAMs: n of 4 planes shot down"; shot streak +
puff; toasts "💥 X's SAM shot down one of your planes (−N troops)" / "🎯 Your SAM shot down one
of X's planes" (no sound). **Browser** (own tab, Teams on Islands, Easy): built a SAM and an
Airport with gifted gold; card, ring with interceptor marks, upgrade preview; an enemy test
flight over our SAM lost a plane (toast, ring mark emptied); our test flight into an enemy SAM
lost a plane (toast, red ring in the air defence view, puff); SAM placement ghost; no console
errors. The map gave no enemy land under an airlift route, so the airlift warning is covered by
unit tests. Tests: 392 (16 new: `tests/sim/sam.test.ts`, `tests/client/sam.test.ts`).

**Milestone 2B.3 result (2026-10-07)** — Airport II airborne assault and Fortress Wall flak
(GAME_DESIGN §3.17.7 "as built (2B.3)", §3.17.6, ARCHITECTURE §5.7). **Rules:** Airport level II
"Military Airport" (+300k, 20 s; 300 km, lifts 15% of capacity, 25 s cooldown shared by airlifts
and assaults). Command `assault {buildingId, tile, percentBp}`: onto a living enemy's land in
range (not your own, a teammate's, an ally's, neutral land or sea; not during spawn protection);
four transports (helicopters on screen) carry the send share capped like an airlift; over the
tile the troops land as a **beachhead attack** (2.7's `launchBeachhead`, focus = the landing
tile) with **×1.25** losses per tile; the pocket is safe from encirclement while it advances.
Landing on land that became yours: home; a friend's: they fly back. SAMs shoot assaults like any
flight. **Fortress Wall flak** (defined here — the design only named it): a hostile flight that
flies into the 3 km reach of a standing Fortress Wall tile loses one plane to that wall — once
per entry (stateless: "inside now, not a tick ago"), friends never shot. `Attack.airborne` (and
on `attackStarted` / attack snapshots), event `assaultLanded`, `flightIntercepted.weapon`.
**Decided here (minor):** assaults and airlifts share one cooldown; an assault lands exactly on
the clicked tile (no coast search: anywhere in range); a landing on a friend flies back instead
of attacking; flak = one plane per wall per entry, no reload, same "hostile" rule as SAMs; the
hover card and boat preview hide while aiming a lift (they offered a boat on enemy land — found
in the browser). **Nations:** `chooseAirTarget` — with a ready Military Airport, enemy nations
and humans they don't border or whose front is walled, estimated like a land attack with the
airborne losses, the lift cap and the planes the route's SAMs would down, ×`airPreference` 0.6,
busy/depleted enemies preferred; landing at the enemy's heart (behind walls) or, across the sea,
the quietest coast in range; it competes with the best land target by score (as a pure fallback
nations never used it). Airport + upgrade valued at `assaultWorth` 0.15 × capacity only while
such an enemy is weak enough that one lift pays off (valued for any enemy in reach, Continent
nations built 0.8 Airports a game and never assaulted). **Headless** (same settings as 2B.2,
whose numbers are in brackets): Islands FFA (30 games) 0.7 assaults a game, 0.6 landed, ~1,350
tiles taken by landed armies, 2.0 Airports / 1.3 upgrades, 1.7 SAMs, median 21.9 min [20.4], max
24 [35.9], no game over 30 min [2]; Continent FFA (60) 0 assaults — nations reach an Airport
only in the last minute (trace: built at 6.8–9 min of 6–10-minute games), median 8.8 [8.9];
Two lands teams (60) median 6.4 [6.4], 0.1 assaults. No teleport-army meta: a lift of 15% of
capacity at ×1.25 losses only beats a busy or depleted enemy. **0 planes shot down** by SAMs or
flak in bot games again — nations route around SAMs and only assault reachable hearts; SAMs
deter rather than kill, `samWorth` left as is. **Regression:** with flights off the 18
seed-by-seed games replay 2B.2 exactly; before the AI changes, flights-on games did too.
**Browser** (own tab, port 5178, Teams ×4 on Islands, Easy; gold from teammates by `sendAs`):
Airport → Military Airport, card ("Airlift troops" + "🪂 Airborne assault — up to 23K", the ×1.25
note, "Level III … later update"), 300 km ring, aiming line "🪂 23K · 11 s", refusal text over a
teammate's land, the helicopter in flight (mirrored, owner shadow, troops label), the landed
pocket attacking in the middle of the enemy's island, the chip "🪂 Solmere 23K Hopeless" (they
had 230K at home: as designed), a Fortress Wall's flak hitting an enemy test flight (event
`weapon: "flak"`, toast "Your … flak shot down one of Solmere's planes"), no console errors.
Not seen in the browser (unit-tested): being the target of an assault. Tests: 414 (22 new:
`tests/sim/assault.test.ts`, `tests/client/assault.test.ts`).

**Milestone 2B.4 result (2026-10-12)** — Airport III air strikes, suppression and escorts
(GAME_DESIGN §3.17.7 "as built (2B.4)", §3.18, ARCHITECTURE §5.7, D-029). **Rules:** Airport
level III "Air Base" (+700k, 25 s; 350 km, lifts 20%, lift cooldown 20 s, `strikeCooldownTicks`
300 in its own slot 1, `escorts` 2). Command `airStrike {buildingId, tile}`: 4 fighters
(`strikePlanes`) to an enemy's tile in range. On arrival, an enemy building on the tile loses a
level if ≥ `strikeDamagePlanes` 2 arrive (level I or unfinished: destroyed; an upgrade under way
is lost) and is disabled `strikeDisableTicks` 200 either way; otherwise the enemy's land within
`suppressionRadius` 10 is suppressed for `suppressionTicks` 300 (`suppressedLoss` 0.8). Escorts
are shot first by SAMs and flak. **Decided here (minor):** strike on the building standing on
the clicked tile, else on the point (the HUD snaps to a building icon); a strike is free but for
its cooldown; "disabled" = does nothing (no bonuses, SAM silent, no missions, Port no boat
bonus/trade); suppression covers only the struck player's land; flak is suppressed too; fighters
use the existing plane art (it is fighters) — no new art needed. **Nations:** `ai/strike.ts`
(see GAME_DESIGN); Air Base valued at `strikeWorth` 0.5 × capacity while enemy buildings are in
reach — 0.2 or 1.0 made no difference (0.2 Air Bases/Islands game): the ~1.05M price with
escalation is the barrier, as designed ("leaders only"). **Playtest fix (D-029, the user):**
"getting swallowed … should at least let you fight" — every counter-attack cancelled a landed
army at once (the collision rule), after which its pocket was annexed. Landed armies (airborne
and boats) no longer collide; nations aim counters at the landing pocket. **Headless** (30
Islands, 60 Continent, 60 Two lands teams; after D-029, before it in brackets): Islands median
23.0 min [22.0], max 25.6, 0.7 assaults all landing, ~3,600 tiles taken by landed armies
[~1,350], 0.2 Air Bases, 1.2 strikes; Continent 8.6 [8.8]; Two lands teams 5.4 [6.4] (landings
stronger). **Regression:** before D-029, flights-off games replayed 2B.3 exactly; D-029 changes
boat games on purpose. **Browser** (own tab, 4 teams on Islands, Easy, gold from every nation by
`sendAs`): Air Base card (new lines, "💥 Air strike — 4 fighters"), aiming labels "💥 destroy
Port · 2 s" (snapped to the icon), "💥 Industrial Complex → level I · 10 s", "suppress 10 km for
30 s · 11 s" with the zone ring; the fighters in flight; toasts "💥 Air strike hit Sereth's
Port: destroyed" / "… Industrial Complex: down to level 1, out of action 20 s"; the struck badge
and "Out of action after an air strike — 10 s" on its card; a suppression zone with
"💥 suppressed · 24 s"; no console errors. Not seen clearly in the browser (unit-tested):
escort fighters on the map. Tests: 442 (`tests/sim/strike.test.ts`, `tests/client/strike.test.ts`,
one D-029 test in `tests/sim/assault.test.ts`).

**Milestone 2B.5 result (2026-10-12)** — Missile Silo I–III, SAM II/III against missiles, Factory
III war production, explosion particles (GAME_DESIGN §3.17.8 "as built (2B.5)", ARCHITECTURE §5.7,
D-030). **Rules:** Silo 250k / +400k / +800k (15 / 20 / 30 s); slots 1 / 2 / 3, reload 30 / 25 /
20 s; range 250 / 400 km / the whole map; strike missile 75k (enemy buildings within 8 km −1
level, out of action 20 s; the target's land suppressed 8 km for 30 s), bunker buster (II, 75k,
−2 levels), strategic warhead (III, 500k, 90 s: 20 km scorched neutral land, 3× expansion cost for
60 s, buildings destroyed, home troops lost in proportion; allies hit → alliance broken). SAM II
stops missiles, SAM III the warhead too, and warns of launches within 90 km; Factory III: Airports
and Silos within 60 km reload 25% faster. **Particles (the user's request mid-milestone):** every
explosion (SAM/flak hits, strikes landing, buildings hit, missile and warhead blasts) throws
sparks, fire, smoke and debris — client-only. **Nations:** `ai/missile.ts` (see GAME_DESIGN);
`siloWorth` 0.4. **Headless** (30 games each, before in brackets): Islands median 22.7 min
[23.0], 0.9 Silos, 0.1 Silo III, 0.3 strike missiles + 1.8 bunker busters, one warhead in 30
games (1,257 tiles, 23K troops), 0.1 Air Bases [0.2]; Continent 9.0 [8.6], no Silos; Two lands
teams 5.0 [5.4]. **Regression:** flights-off games replay 2B.4 (6cea105) exactly (12 games, 4
configs). **Browser** (own tab, Islands, Easy, 0 tribes, gold from allied nations by `sendAs`):
Silo I → III built and upgraded; the cards ("Missiles ▮▮▮ all ready", 🚀 Strike missile 75K,
🎯 Bunker buster, ☢ Strategic warhead 500K); aiming labels "🚀 2 buildings −1 level · suppress
8 km for 30 s · 75K gold · 8 s" and "☢ scorch 1,257 tiles of land · 500K gold · 9 s"; "⚠ SAMs on
the route would shoot it down" with only the SAM II ringed; a strike missile struck a Port II and
destroyed a Housing; missiles and a bunker buster shot down by a SAM II (explosion particles in
slow motion); the warhead's blast (fire, sparks, debris, shock ring), the charred "☢ scorched ·
60 s" circle and the toast "☢ Your warhead scorched 1,257 tiles — Valdorra lost 12.5K troops"; no
console errors. First version drew the smoke over the fire — fixed (smoke underneath, lighter).
Tests: 473 (`tests/sim/missile.test.ts`, `tests/client/missile.test.ts`).

**Milestone 2B.6 result (2026-10-14)** — Port III Naval Base, warships, coastal fortification,
and the Phase 2B balance pass (GAME_DESIGN §3.18.1, ARCHITECTURE §5.7 "Warships", D-031).
**The user's choices at the start:** warships patrol automatically (no steering); they attack
troop boats, warships and trade ships of non-friends; warship art from an image prompt I wrote
(`docs/art/WARSHIP_ART_PROMPT.md`) — a grey troop boat stands in meanwhile, labelled on the
Port card. **Rules:** Naval Base +300k / 20 s, +25 gold/tick, a trade ship every 7 s, 2
warships patrolling 40 km (1.5 km/tick, 1,000 health, a shell every 2 s within 8 km: sinks a
troop boat or does 250 damage; trade ships boarded, cargo to the captor's Port; rebuilt after
60 s), its owner's coast within 30 km a Stone Wall. **Decided during the milestone:** trade
ships bound for the owner's or a friend's Port are left alone (headless: otherwise ~180
captures a game, everyone's trade starved); nations keep their boats out of waters hostile
warships guard. **Balance pass:** team games need **85%** combined land (was 70%: 4 v 4 on
Islands ended with the land race, 5.5 min, a level-III building in 3/30 games → 9.3 min,
16/30); `navalBaseWorth` 0.15 (at 0.3 nations built 4.1 Naval Bases a game on Islands and
almost stopped building Silos and Air Bases). The Phase 2 carry-overs: aggressors now win
14/60 Continent games (5/60 at Phase 2); Islands free-for-alls 20.6 min (22.7 before 2B.6),
inside the accepted 15–20 min band's upper edge; team games no longer end before Phase 2B's
content. **Headless** (final rules): Islands (40) median 20.6 min, wins expander 13 · turtle
14 · opportunist 7 · aggressor 6, 2.7 Naval Bases, 5.4 warship launches, 2.8 trade ships
captured, 7.5K boat troops sunk a game, 0.7 Silos, 0.3 missiles, 0.6 assaults, 0.4 strikes;
Continent (60) 8.8 min, 15 · 18 · 13 · 14; Two lands (40) 10.1 min; Islands 2 teams (30) 9.3
min, teams 15 · 14; 10 nations + 100 tribes (30) 10.8 min. Ticks average ≤ 1 ms, warships
0.01 ms; no errors, no timeouts, every game has a winner. **Regression:** warships-off
free-for-all games replay 2B.5 (3ebaaaa) exactly (9 games, 3 configs; team games differ by
design — the 85% goal). **Browser** (own tab, Islands, Easy, 0 tribes, gold from allied
nations by `sendAs`): Port I → III built; two grey warships patrol; an enemy boat of 25.5K
troops sunk off the coast (shell streak, splash, toast "⚓ Your warship sank Westmarch's boat
(21.3K troops)" on a second try); the Naval Base card ("Warships: 2 of 2 at sea", the stand-in
note); the coast drawn as a grey stone line (first version: separate dots at high zoom —
joined into a line); no console errors. Tests: 489 (`tests/sim/warships.test.ts`, team goal
in `tests/sim/teams.test.ts`).

**2B.6 playtest round (2026-10-15, D-032)** — the user played 2B.6: "Warships need to be
controlled by players … too close to shore. Missiles should destroy bases or suppress them.
Missile attacks kill population too. Bots don't use missiles or engage in much combat." Placed
in Phase 2B (changes to its own systems, before the tag) and done: **warship orders** (click
your warship, then the sea: it sails there and patrols / fights within 15 km; `moveWarship`,
tile -1 = home), patrols **4 km offshore**; **strike missile** −2 levels (I–II destroyed), 60 s
out of action, 10% of the victim's troops killed; **bunker buster** destroys its building, 5%
killed; **nations** value missiles with the troops they kill and fire at 1.2× the price (was
2×), Silos worth 0.6 (was 0.4), one warship blockades the enemy's nearest Port while at war
(`ai/warship.ts`), expanders and opportunists attack sooner. **Headless** (Medium = what the
user plays; before in brackets): Islands (40) median 18.6 min [23.0], 369 player attacks a game
[344], 4.2 missiles [0.7], 1.7 Silos [1.1], 19.5 trade ships taken and 0.6 warships sunk by
blockades; Islands Hard 18.1 min [20.6], 4.1 missiles [0.2]; Continent Hard (60) 8.8 min, wins
expander 16 · turtle 21 · opportunist 12 · aggressor 11; Islands 2 teams 8.5 min, teams 14 · 16.
No errors or timeouts; warships ≤ 6 ms worst tick (the shore-distance field is computed while
the game loads). **Browser** (own tab): a warship selected by clicking it (white ring, its
dashed patrol circle, the banner "⚓ Warship selected — click the sea …"), sent by a click on
open sea (the order event, the ship there 2 km from the spot), its 15 km circle; the other one
patrolling offshore; a strike missile on an enemy Housing: destroyed, the enemy 612.9K → 548.9K
troops, toast "🚀 Your strike missile hit 1 building: −2 levels each · 60.9K troops killed"; no
console errors. Tests: 496.

**Phase 2B playtest round (2026-10-16, D-033)** — the user played Phase 2B ("This feels good")
and asked for twelve changes; placed here because they tune Phase 2B's own systems and HUD
(none is a new system). Asked three concrete questions (splash, troops, icons) — the user chose
craters + blasts, "Housing matters more" **and removing Mobilize entirely**, and colour + symbol
badges. Done: **strike-missile crater** (4 km of enemy land burns to neutral, 30 s at 3× to
retake, troops lost in proportion; standing buildings' tiles spared so the buster keeps its job),
**bunker-buster splash** (−1 level within 4 km), missiles **60 km/s**, a **missile launcher** in
the command bar (R / T / X; each click on enemy land fires from the nearest Silo that can, while
missiles are left); **Mobilize removed** (command, button, key M, Factory discount, war chest),
land capacity −⅓, Housing 2.5× (75k / 225k / 625k), "🏠 +75K" on the troop bar; **keys 1–7**
for the build bar (presets on Shift+1–5); build-bar tiles fit their text (one-line names, the
key on each, wrapping row); **type badges** (colour + symbol) on the map, build bar and cards;
**level pips** on zoomed-out dots; the **hover card** hidden over unclaimed and tribe land and
rebuilt as labelled rows; trade 1,000 + 12/tile (cap 6,000); **80%** to win (FFA). Investigation
of nations' troops: land gave ~90% of their capacity and Mobilize turned their gold into armies
(1.7M troops in 12 min for one nation); after: Housing gives 60–80% of a big nation's capacity
late in the game. **Headless** (Medium; before in brackets): Islands (40) median 20.4 min [18.6],
370 player attacks a game [369], 8.6 missiles [4.2], 2.5 Silos [1.7]; Islands 2 teams (30) 11.2
min [8.5], teams 13 · 17; Continent Hard (60) 10.1 min [8.8], wins expander 14 · turtle 17 ·
opportunist 15 · aggressor 14 [16 · 21 · 12 · 11]. No errors, no timeouts, every game has a
winner. **Browser** (own tab): keys 1 / 2 pick up Housing / Factory, Shift+3 sets 50%; the seven
build tiles on one row inside the bar with nothing spilling out (it overflowed at 800 px at
first: tiles tightened, the bar widened to 700 px); badges on the map icons and build bar; a
Silo II's launcher "🚀 Missile 2 · 🎯 Buster 2", R then two clicks on an enemy fired two strike
missiles and aiming ended by itself; the aiming preview with the red crater inside the 8 km
circle ("crater: 49 tiles burned · …"); two craters on the map and the toast "🚀 Your strike
missile hit — no buildings there · 49 tiles of land burned · 56.8K troops killed"; zoomed-out
Housing dots in green with one and two pips; the hover card over a nation (Troops, Land, Gold,
Housing rows) and none over a tribe; no console errors on a fresh load. Tests: 490.

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

**Decisions (2026-10-16, the user's answers):** D-006 accepted — option C, the server runs
the same simulation, validates and relays commands, compares hashes and repairs a drifting
client with a snapshot; D-034 a cloud host from the start (one Node service for the client
and the WebSocket; provider chosen at the start of 3.1); D-035 lobby links **and** public
lobbies, just a name; D-036 nations and tribes fill empty slots (they already run inside the
simulation, so online they cost nothing).

**Milestones** (bots-first spirit: prove the hard part headless before any UI; every
sim-touching change compared seed by seed against `4d597f7` with `tools/hashDigest.mjs` —
bots-only games must not change):

| | Milestone | What it delivers | Proves |
|---|---|---|---|
| 3.0 ✅ | **Snapshots + determinism harness** | `serializeWorld` / `deserializeWorld` (everything `hashWorld` covers plus RNG state, bot brains, maps such as `lastDonationTick`); round trip (snapshot mid-game → continue → the same hashes as never stopping); a command-log replayer; the same seeded game in Node and in the browser (Chromium; Firefox if a test runner is added — ask before installing) with identical hashes tick by tick | that C is viable |
| 3.1 ✅ | **Server skeleton + first deploy** | `src/server/` (Node; one game per worker thread; the sim + a 100 ms turn scheduler; WebSocket via the `ws` package — ask first); `NetworkHost` (a `SimHost` on the browser's own WebSocket) in `src/host/`; the server also serves the built client. Two tabs on this computer play one game, then the same build runs on the cloud host (**provider: the user's choice at the start of 3.1**, D-034). Only unguessable game links; connection and message-size limits | two browsers, anywhere, play one game |
| 3.2 ✅ | **Lobby by link** | create a game with the solo settings, share the link, names (D-035 rules), Ready, the creator starts; nations and tribes fill the rest (D-036) | friends can join |
| 3.3 ✅ | **Validation & rate limits** | the server stamps the sender (never trusts a claimed `playerId`), rejects malformed or invalid commands (the sim already validates every command when it runs), per-player command limits, oversized/too-frequent messages dropped, misbehaving connections closed | nobody can cheat or flood |
| 3.4 ✅ | **Public lobbies** | a list of open games on the start screen, one-click join, a start countdown once enough players are in, the name blocklist (D-035) | strangers can find a game |
| 3.5 ✅ | **Hash checks, resync, reconnect, spectators** | clients check every turn's hash against the server's and ask for a snapshot when they drift; rejoin with a secret seat token (reload, reopened link, dropped connection — retried by itself); late join = watch (snapshot + the turns since) | robustness |
| 3.6 ✅ | **Online feel** | instant pending feedback on clicks (command → next turn ≈ 100–200 ms), teams online, the end-of-game screen from the server's result, a latency indicator; pause/speed are solo-only | it feels like the solo game |
| 3.7 ✅ | **Accounts & profiles** *(added 2026-10-17 at the user's request)* | **optional** sign-in (**D-037**, accepted 2026-10-18) — **Google** or a **name + password** account with no email (one-time recovery code); guests keep playing with just a name (D-035). Public profile: display name (the lobby name rules + blocklist), join date, games played, wins — only online games with ≥ 2 humans count; signed-in names are reserved. Built with no new packages: **SQLite** (`node:sqlite`) on a **Railway volume**, `crypto.scrypt` for passwords, a random session key in a secure cookie (server keeps its hash). No email kept; "Delete my account" erases everything at once. Needs from the user: the Railway volume and a Google Cloud OAuth client (I write the steps). A short privacy note | people can keep a name and a record |
| 3.8 ⬜ | **Multiplayer playtest + hosting hardening** | the user plays with friends on the cloud host (signing in too); logs, restarts without lost lobbies where possible, a load check (many bot games on one server) | Phase 3 approval |

**3.0 result** *(done 2026-10-16)*. `src/sim/snapshot.ts`: `serializeWorld` / `deserializeWorld`
save the **whole** World generically (every field of every game object, so a field added later
is saved without touching it; an unknown class makes it throw rather than drop data) except the
map, the rules (checked by fingerprint: a snapshot refuses another map or other rules) and
per-tick scratch. Exact by construction: doubles round-trip through JSON, −0 / NaN / ±∞ and
`undefined` are tagged, Map and Set keep their iteration order (bots iterate border sets), a
TileQueue keeps its heap layout and insertion counter (`save` / `restore`), the RNG its four
words; the rebuilt world must hash to the saved hash. Typed arrays run-length encoded. Size and
speed (Islands 1100×700, 18 bots): **~150–450 KB of JSON**, saved in ~15 ms, rebuilt in ~10 ms.
`src/sim/replay.ts`: `CommandRecorder` (seed, players, the turns that carried commands,
checkpoint hashes) and `replayLog` (from the start, or from a rebuilt snapshot + the turns since
— the reconnect path; reports the first checkpoint that differs). **Tests** (11, all through
JSON text and on a freshly generated map, so no per-map cache carries over): a generated Islands
game with a scripted human, nations and tribes — snapshots every 400 ticks each play on 250
ticks hash for hash, the log replays the whole game to the same full state; a staged war with
every 2B system in play (airlift, assault, point and building strikes, strike missile, buster,
warhead, SAM interceptions, warships firing, boats, trade, pings, suppression, scorched land) —
a snapshot every 7 ticks, each played to the end with the same hash every tick **and the same
full state** (hashed or not); encoding edge cases; refusals (another map, other rules, a
tampered state, a newer version, an unknown class). **Cross-engine**: `tools/determinismGames.ts`
(pure, imported by both) + `node tools/crossEngine.ts`: six 3,000-tick games (Islands Hard,
Continent Medium with 40 tribes, Two lands 2 teams; a scripted human in each) and one
12,000-tick Islands Hard game gave **identical** per-tick digests, checkpoints and halfway
snapshot text in Node 24 and the browser (Chromium 152), and each resumed from its snapshot to
the same digest. Firefox/Safari not checked yet (would need a browser test runner — a package,
ask first; the user's friends' browsers are the real test in the 3.8 playtest). Bots-only games identical to
`4d597f7` (`tools/hashDigest.mjs`, Continent / Islands / Two-lands teams, seeds 1–2). Tests: 501.

**3.1 progress** *(2026-10-16)*. Provider **Railway**, US East, `ws` (D-034). Built:
`src/shared/protocol.ts` (messages, settings check, `gamePlayers`), `src/server/` — `main.ts`
(one Node process: `dist/` with path guard and cache headers, `/health`, WebSocket `/ws` with an
8 KB message cap, 40 messages/s, ping every 25 s), `lobbies.ts` (create / join by an
unguessable 12-character id / creator starts / leaving; up to 16 humans, 20 games), `game.ts`
(`ServerGame`: queue → stamp with the connection's player → tick → turn + hash; `commandProblem`
shape check, `testFlight` never accepted online), `gameWorker.ts` (one game per worker thread,
drift-free 100 ms schedule); `src/host/networkHost.ts` (the worker simulation runs the server's
turns — `LocalHost.applyTurn`, `WorkerHost` `turns` mode — and compares every tick's hash with
the server's); client `online.ts` + `LobbyScreen.svelte` (link + Copy, players, Start, Leave),
"Play online with friends" on the start screen, `?game=<id>` links, the pause menu doesn't
pause online and has no speed buttons; `railway.json`; `npm start`. **Checked:**
`tools/onlineSmoke.ts` — two scripted players over real WebSockets, 300 turns each, **0 hash
mismatches**, both expanding; two browser tabs (dev page and the production build served by
the server) — lobby by link, Start, both spawned and expanded, in sync, no console errors; the
solo game unchanged. Tests: 508 (7 new: lobbies, stamping, refusals, leaving, `ServerGame`,
shape checks, team dealing). **Deployed 2026-10-17:** the user set up Railway (GitHub `worstpart/OpenBorders`, auto-deploy on
push) — **https://openborders-production.up.railway.app** (`/health` → `ok N games`; it serves the
same bundle as a local build). Over the internet: `tools/onlineSmoke.ts
wss://openborders-production.up.railway.app/ws` — 300 turns each, **0 hash mismatches**, 10
turns/s; two browser tabs on the public address (production build, no debug hook: real map
clicks) — lobby by link, Start, spawn, expand, no drift warnings, no console errors; **click →
visible on the map in ~155 ms** (spawn, both tabs); the server closed the game when both left.
**Milestone 3.1 done.**

**3.2 result** *(2026-10-17)*. Protocol v2 (an older page is told to reload). **Names** (D-035):
`cleanName` — trimmed and collapsed, letters of any alphabet, digits, spaces and `._'!?&()-`
only, at most 16; `uniqueName` — "Sam (2)" against the other humans **and the bots' names**;
typed in the lobby (Enter or leaving the field sends it), remembered in this browser
(`openborder.name`), the server always re-cleans. **Ready**: joiners press "I'm ready" / "Not
ready after all"; the creator always counts as ready and **may start any time** — the button says
"Start anyway — N not ready" (mine: one absent friend can't block a game). The lobby shows the
game's settings ("Continent · Normal · Free-for-all · 7 nations (Medium) · 25 tribes") and
joiners see "Starting… preparing the map". Checked: `tools/onlineSmoke.ts` with names and ready
(0 mismatches); two tabs — rename to Alice, the second tab joined as "Alice (2)", renamed to Bob,
ready / not ready, "Start anyway — 1 not ready", Alice and Bob in the game's player list, no
console errors; a squashed name field fixed. Tests: 511 (names, duplicates against bots, ready
flags, the summary, start with players not ready, renames ignored after the start).

**3.3 result** *(2026-10-17)*. `src/server/validate.ts`: **exact command shapes** — every online
command type has its field list (kind and range: tiles 0..16M, players 0..65,535, ids,
percentages 0..10,000, booleans, the building / missile / ping / resource names, walls of 2–32
points); unknown types (incl. `testFlight`, `__proto__`), missing, extra (a claimed `playerId`)
or mistyped fields are refused before a turn — a new command without a schema is a compile
error. **Budgets** per connection: 30 at once, 15 a second (a human clicking 8 a second for a
minute is never limited); excess dropped, 60 drops → closed ("too many messages"); 20 malformed
commands → closed. **Limits**: 8 connections per address and 2,000 in all (HTTP 429 beyond), 3
open games per address, 8 KB messages, 40 messages a second; behind Railway the address is the
last `X-Forwarded-For` entry (trusted only there). A message that makes the lobby code throw
closes that connection, never the server; a game id search can no longer loop forever.
**Fuzz**: 4,000 random commands that pass the check (edge values, real tiles and ids, gold for
builds and missiles) thrown at a real Islands game from two players — every tick ran, and the
same garbage gives the same hashes. `tools/onlineAbuse.ts` against the server: a 300-command
flood closed, 30 junk commands closed, the 9th connection refused (429), a 20 KB message refused;
an honest game alongside: 0 mismatches. Tests: 519.
**On Railway** (deploys are manual — the user presses update after each push): the first live
check showed the per-address limits not applying (every connection looked like the proxy).
Fixed in two steps (1ec075d: Railway detected by its documented variables; 74b1343: the
client's address from the edge's `X-Real-IP`, which Railway overwrites — a faked header is
ignored; the last `X-Forwarded-For` entry was an intermediate hop). `/debug/address` shows a
caller their own address headers; `/health` reports games, connections and proxy trust. Live
`tools/onlineAbuse.ts`: flood closed, junk closed, **9th connection refused (429)**, 20 KB
refused; honest smoke 100 turns, 0 mismatches. **Milestone 3.3 done.**

**3.4 result** *(2026-10-17)*. Protocol v3. A game is **private by default**; its creator
flips "Public — anyone can join from the start screen" in the lobby (`visibility` message).
`GET /api/games` lists open public games (fullest first, at most 20, full and started ones left
out; readable cross-origin for the dev page); the start screen shows them under "Open games"
(creator's game · map · size · mode · players, "starting soon") with **Join**, refreshed every 4
s. **Countdown** (mine): a public game with 2+ players starts by itself after **30 s** (a joiner
doesn't reset it; dropping below 2 stops it; the creator may still start early; it can't start a
game twice); everyone sees "Starts by itself in N s". **Name blocklist** (D-035,
`src/shared/nameFilter.ts`): a short list of words offensive anywhere inside a name, matched
after lowercasing and reading lookalikes (`sh1t`, `F.U.C.K`, `a$hole`); applied in every lobby
(a private game can go public): a blocked name on joining becomes "Player N", a rename to one is
refused; chosen to spare ordinary names (Bassist, Grapes, Nazir, Cucumber, Kyshawn, Dickens).
Checked: two tabs — public switch, the game on the other tab's list, Join, "Starts by itself in
29 s" counting down in both, the game started by itself, the list empty again; no new console
errors. Tests: 525.
**Live (2026-10-17):** on Railway the public switch, the list and the countdown worked — and the
user joined the test game from their own start screen, so a real player went through public
lobby → countdown → start. It exposed a bug: the spawn phase waited for **every** human to
confirm, so one absent player could hold a game in the spawn phase forever. Fix (mine; solo
unchanged): `rules.spawn.timeoutTicks` (0 = wait, the default) and `ONLINE_RULES` (shared,
used by the server and every browser) with a **60 s spawn phase**; at the timeout, unconfirmed
humans keep the spot they clicked or get a random one, and the match starts; the spawn prompt
shows the seconds left ("Waiting for the other players… N s" once confirmed). Protocol v4.
Checked: 3 sim tests; a lone online game left alone started itself at tick 600 with a random
49-tile spawn; bots-only games identical to `4d597f7`. Tests: 528. Deployed after the user's game
(e4cb1ae): live smoke 700 turns (past the 60 s spawn timeout) with `ONLINE_RULES` on both sides,
0 mismatches. **Milestone 3.4 done.**

**3.5 result** *(2026-10-17)*. Protocol v5. **Repair:** a browser checks every turn's hash (and
that turns follow each other); off by one, it sends `desync`, drops turns until the server's
`sync` (a `serializeWorld` snapshot made by the game's worker thread between two ticks, sent as
the JSON the worker made — never re-encoded) and replaces its worker's world with it
(`deserializeWorld`); the snapshot and the turns after it travel on the same socket in order, so
no turn history is needed. The page redraws only the tiles that differ and drops effects drawn
from the old world. Asked again after 8 s if nothing came; the server answers one connection at
most every 5 s, and everyone waiting shares one snapshot; a failed snapshot is an error message,
never the end of the game. **Rejoin:** `start` gives each player a secret token, kept by the
page in sessionStorage (this tab: reloads; two tabs of one browser never swap seats) and
localStorage (a link reopened in a new tab); the address bar shows the game's link, so a reload
or a reopened tab sends `rejoin` and the player is back in their country (`start` with
`midGame`, then a snapshot — the page never shows tick 0 of a game in progress). A rejoin from
another tab takes the seat over and the old tab says "This game was opened in another tab."
Others see "X lost the connection — their country waits for them" / "X is back". Seats are kept
for the whole game (the country stands idle); a game nobody plays any more runs on **2 minutes**
for a rejoin, then stops (mine). **Auto-reconnect:** a dropped connection is retried after 1, 2,
4, 8 and 15 s ("Connection lost — reconnecting (try n of 5)…"), then given up; a refused rejoin
(the game ended, the server restarted) says so. **Spectators:** a link to a running game opens
it to **watch** (player 0, up to 32 a game; commands ignored, no menus, no "you" toasts — 0 is
also neutral land); running public games stay on the start screen's list ("Public games") with
**Watch**. Messages over 16 KB are compressed (permessage-deflate; turns stay plain). The page
shows the online state as a banner over the toasts (catching up, reconnecting, watching,
errors). Dev hooks: `__openborder.corrupt()` (a square of land changes hands in this browser's
world only) and `dropConnection()`; `localStorage["openborder.devServerPort"]` points the dev
page at another local server. **Checked:** tests (server: tokens, takeover, wrong tokens, the
grace, watchers and their limit, shared snapshots, cooldown, the server game's snapshot
rebuilding its exact world; host: a corrupted client repairs and runs in step, a missed turn
counts as a drift, a mid-game join starts from its snapshot, a reconnect waits for its snapshot);
`tools/onlineSmoke.ts` now also corrupts the creator (1 mismatch, repaired, then in step), adds
a spectator mid-game and drops and rejoins the joiner (0 mismatches each) — passed; in three
tabs: a corrupted tab caught up in under a second, a reloaded player came back into their
country, a watcher followed the game, a dropped connection came back by itself while the other
tab showed "lost the connection" / "is back"; no console errors. Snapshots early in a game:
35–56 KB of JSON. Not in scope: games surviving a server restart (a Railway update still ends
them — 3.8). Tests: 545.
**Live (2026-10-17, 4f8608a):** `tools/onlineSmoke.ts` against Railway — 400 turns; the corrupted creator repaired (1 mismatch, 1 snapshot), the spectator and the rejoined joiner 0 mismatches — OK; permessage-deflate negotiated through Railway's proxy; in the browser on the live site a reload mid-game put the player back in their country and a second tab watched. **Milestone 3.5 done.**

**3.6 result** *(2026-10-17)*. Protocol v6. **Orders on their way:** online an order reaches
the game only when the server's turn brings it back; `NetworkHost` keeps every order sent
until a turn carries it (matched by the order's JSON, the local player's only; lost ones are
dropped after 4 s, a snapshot clears them). Meanwhile the map shows a small spinning ring where
it was aimed (attack, spawn, boat, build, airlift, strikes, missiles, warship moves, pings, the
last wall point), and the HUD says "sending…" when one takes over 250 ms. The time each order
took is measured — the delay players actually feel. **Latency:** the browser pings every 2 s
(`ping` → `pong` with its own clock), and the top-right status chip shows the smoothed round
trip with a green / yellow / red dot (under 150 / 300 ms / more), its tooltip also the order
delay; when no turn came for 1.5 s while playing, the banner says "Waiting for the server…".
**Teams online** (D-035 amendment, the user's choice): players pick their team in the lobby — a
newcomer goes to the smallest team, a click on **Join** switches; the lobby shows each team's
players and how many nations will join it; at the start the nations even the sides out (to the
smallest team, ties to fewer humans). Checked end to end: team colours and names the same in
every browser, teammates' pings, the team goal (85%). **End of game:** the end card already
comes from the simulation (the same everywhere); now when it ends the page forgets its seat and
clears the address bar (a reload opens the start screen instead of "That game has ended"), stops
reconnecting, and a watcher gets its own card ("Game over — Team Blue won the match", the
winner's or winning team's land, Back to start). The server keeps a finished game **2 minutes**
(`FINISHED_GAME_KEEP_MS`; its worker keeps the final world): a player whose connection dropped
just before the end rejoins and sees the end card; finished games aren't listed, watchable,
played or counted against any limit (/health counts only live games). **Start screen:** "Rejoin
your online game" when this browser still keeps a seat (a tab closed mid-game). The player
card's win line no longer says "70%" (the share needed shrinks over time). Dev hook:
`__openborder.lag(ms)` holds every outgoing message, like a slow connection. **Checked:** tests
(teams dealt and picked, ping, finished games kept and closed, pending orders and their delay,
the HUD helpers, the banner); `tools/onlineSmoke.ts` now plays a 2-team game where the joiner
switches to the creator's team (both on team 1, nations 3 v 3) and checks a ping comes back —
passed (still 0 mismatches apart from the planned repair); new `tools/onlineEnd.ts` — a game
won at the start, then a rejoin gets the finished world, a spectator is told it ended, the
server counts 0 games — passed; in three tabs: team lobby and switching, nations as previewed,
a teammate's ping, the order ring under 250–1000 ms of simulated lag, the ping figure, a
reload rejoining after a hot reload, a watcher's and a player's end card, the seat forgotten,
"Rejoin your online game" bringing a closed tab back (the old tab: "opened in another tab");
no console errors. The simulation is unchanged (bots-only games identical). Tests: 556.
**Live (2026-10-18, ef05796):** `tools/onlineSmoke.ts` against Railway — 400 turns, the 2-team game dealt 3 v 3, the planned repair only, ping ~75 ms from here — OK; `tools/onlineEnd.ts` (now compares the server's game count with the one before it started, as other games may run) — OK; in two tabs on the live site: the team lobby and switching, the order ring at real latency, the status chip "● 68 ms" with "your orders reach the game in about 95 ms". **Milestone 3.6 done.**

**3.7 result** *(2026-10-18, D-037)*. Protocol v7. **Optional accounts:** the start screen says
"Playing as a guest · Sign in · Create account" or "Signed in as X · Profile". A **name +
password** account needs no email; creating it shows a one-time **recovery code** (20 letters
that can't be mixed up, shown once, "I saved it" to close) — with it a forgotten password is
replaced, the code renewed and every other sign-in ended. **Google** sign-in (authorization code
with PKCE, scope `openid` only, so we learn just Google's account number) appears once the
server has `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; a new Google account gets a stand-in
name ("Commander 1234") and the page asks for a real one at once. **Profile:** name (renamed
there), join date, games, wins; sign out; delete (confirmed, erased at once, name free again).
Public profile cards open from a ✓ name in the lobby. **Lobbies:** a signed-in player plays under
the account name (the lobby's name field is read-only for them); a guest asking for an account's
name (any capitals) gets "Name (2)". **Counting:** a game counts when it starts with ≥ 2 humans
(online only — solo games run in the browser); wins: the winner, or every member of the winning
team, connected or not; the game worker now reports the winner with `ended`. **Built without
new packages:** `node:sqlite` (`src/server/accountStore.ts`, one file in `DATA_DIR` — on Railway
the volume's `RAILWAY_VOLUME_MOUNT_PATH`, locally `./data`, git-ignored), `crypto.scrypt`
(N 2^15, r 8, p 3, per-account salt; SHA-256 for session keys and recovery codes;
`src/server/passwords.ts`), and `src/server/accountApi.ts` (`/api/me`, `register`, `login`,
`recover`, `logout`, `rename`, `delete`, `profile`, `/auth/google` + `/callback`): the
session key in an HttpOnly, SameSite=Lax cookie for 30 days (Secure behind Railway, renewed
at most daily), changes only as JSON POSTs from this site's Origin, tries limited (10 a minute
per address, 10 per 15 minutes per name, 5 new accounts an hour per address), a wrong name as
slow as a wrong password. The game socket reads the cookie on its upgrade (this site's pages
only). `/health` adds "accounts" (or "accounts (not on a volume)") and "Google on/off". A short
**privacy note** (start screen → Privacy, also at `/privacy` for Google's consent page).
**Checked:** 17 new tests (hashing, codes, names, rate limits, the store, the API over real HTTP
incl. Google with a stand-in token endpoint — state cookie, PKCE, wrong audience refused, return
only to this site — and lobbies: reserved names, counted games, FFA and team wins); in my tab
against a local server: create → recovery code → reload still signed in → lobby "Tester One✓",
a cookie-less guest asking for "TESTER ONE" got "TESTER ONE (2)", the profile card, rename,
sign out, sign in with other capitals, delete; the built page on the server itself (same-origin
create / delete); phone width; `tools/onlineEnd.ts` OK. Tests: 573. Not live yet: needs the
Railway volume and (for Google) the user's OAuth client — steps in `docs/ACCOUNTS_SETUP.md`.
**Live (2026-10-18, 1c4e5c9):** the user added the Railway volume at `/data` and updated the
app; the user chose to **skip Google for now** (the code is ready and off until
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set — docs/ACCOUNTS_SETUP.md part B).
`/health`: "accounts, Google off" (on the volume); the live bundle equals the local build;
`/api/me` answers, a too-short password is refused, a request from another site gets 403 and
no CORS headers; `tools/onlineSmoke.ts` 400 turns OK (the planned repair only, ping ~78 ms);
the live start screen shows "Playing as a guest". **Milestone 3.7 done.**

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
all 21 tiers (the user's icon pack covers Housing, Factory, Port, Airport and the ships and
planes from 2B.0b, D-028; the rest in the same style), construction and upgrade animations, aircraft and missile animations, SAM
coverage and Airport/Silo range views, Border Defense wall art per level, incoming-attack
warnings (sound + visual), upgrade previews and ability descriptions, mobile versions of
the building card and target selection. Same rule as everywhere: the map stays the
primary interface; nothing permanent is added to the screen.

## Phase 5 — Production

Match history and leaderboards (built on the 3.7 accounts and profiles), friends/parties (if
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
| Port | **Port** I–II (2.7), III (2B.6) | ✅ I–III | 2.7 / 2B | M | |
| Factory + trains/railroads | **Factory** I–III: plain gold income + Mobilize discount (no trains) | — | 2.5 | M | Trains stay out (opaque) |
| Structure levels/upgrades | **Exactly 3 named levels**, level = health | — | 2.5 | M | Planned (D-021) |
| Transport ships | Same + route/ETA preview | ✅ | 2.7 | H | Weighted A* over sea tiles; the beachhead attack is generic (2B reuses it) |
| Trade ships | Same: Port to Port, both sides paid by distance | ✅ | 2.8 | M | User's request (D-026); no embargo yet |
| Warships & naval combat | Naval Base patrol (Port III); captures non-allied trade ships | ✅ | 2B.6 | H | User: allies immune, all other trade can be intercepted; automatic patrol (D-031) |
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
