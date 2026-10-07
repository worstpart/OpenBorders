# Phase 2 handoff (after milestone 2.7)

> **For the next session: read this file first**, then
> [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md) §4–§6 (how the user wants us to work,
> environment gotchas, repo map — all still valid; the debug hook is
> `window.__openborder`). Written 2026-10-02. Last code commit: "Phase 2.7: islands, boats,
> beachheads, Port I–II (D-025)".

## 1. Where we are

| | |
|---|---|
| Phase 1 | ✅ tag `phase-1` |
| Phase 2 done | 2.0 big lobbies · 2.1 Tribes & Nations · 2.2 alliances · 2.3 teams · 2.4 economy · 2.5 buildings · 2.6 walls · **2.7 islands, boats, beachheads, Port I–II** |
| Next | ⬜ **2.8 more maps** (ROADMAP row 2.8: bigger maps for big lobbies, real-world maps via our own pipeline, `WorkerHost`, re-check spacing/range values) |
| Then | 2.9 sound & events · 2.10 playtest & balance · **Phase 2B air & strategic warfare (before multiplayer, bots first)** · Phase 3 multiplayer |
| Tests | 305 passing, type check clean, Prettier clean |
| Regression | `--no-boats --continent` reproduces 2.6 exactly (8 nations and tribe lobbies, measured); `--no-buildings` still 2.4 on the old map |

GitHub: `origin` = https://github.com/worstpart/OpenBorders.git (branch `main`). After every
handoff: commit, push, confirm `main` = `origin/main` to the user.

## 2. What happened in 2.7

1. Asked the user first: **walls "feel good, move on"** (no changes); and since the map
   had no islands, how boats should get something to cross. Options: a map choice
   (continent / islands — my recommendation), islands always, or one continent until 2.8.
   **The user chose islands always** → D-025.
2. Built: island map layer; boats (sim, AI, HUD, rendering); the generic beachhead attack
   (reused by airborne assaults in 2B.3); landing-pocket encirclement protection; Port I–II.
3. Browser-checked, then fixed three things found there: (a) land on another island was
   offered as a land "expand" because I bordered *some* neutral land → a click on a landmass
   where you own nothing now always sends a boat; (b) the attack chips were hidden behind the
   command bar (it grew in 2.4/2.5 past the fixed `--command-bar-height`) → the bar now
   publishes its real height; (c) long route searches took 30–60 ms (a hover stutter) →
   weighted A* (×2, same routes on the reference map, ~10 ms) and the preview waits until
   the mouse rests 120 ms.

## 3. As built (details: GAME_DESIGN §3.2 + §3.18, ARCHITECTURE §5.7 "Beachhead attacks" / "Boats")

- **Map:** continent 42% of the map + 5–7 islands ~8% (only beyond 18 tiles of sea; islets
  < 400 tiles sunk); `generateContinent({ islands: false })` = the old map (golden test).
- **Player:** click land you can't reach over your border (another landmass, or a player
  you don't border) → a boat with the send %; hover shows "Click: ⛵ boat … lands in N s" and a
  dashed route + landing ring; right-click menu has "⛵ Boat with N%" for any coastal target.
  Chips: "⛵ To X · troops · Lands in N s ↩" (recall), incoming red chip with countdown, red
  toast "⛵ X's boat is heading for your coast", "X landed on your coast".
- **Rules:** 3 boats at sea (+1 Port I, +2 Naval Port, max 6); 1 tile/tick (Port ×1.5 / ×2
  within 30 tiles of the launch); landing = the target's coast nearest the click; launch =
  your coast on that sea that lands soonest (a Port can win); troops aboard count toward the
  cap; landing = beachhead attack (takes the landing tile, never merges with the land army,
  pocket safe from encirclement while it advances); friendly landing tile → troops home;
  recall → back home without loss; owner eliminated → boats sink.
- **Port I–II:** coast only; 50k / +120k; +15 / +40 gold per tick; Naval Port adds Marines
  (landings ×0.8 losses). Port III waits for 2B. No Ports in games without boats.
- **Sim:** `systems/naval.ts` (`seasOf`, `landmassesOf`, `coastTiles` cached per map;
  `planBoat`, `nearestCoast`, `seaRoute`, `boatProgress`, commands `boat` / `recallBoat`,
  `advanceBoats` = tick step 2b); `attacks.ts` `launchBeachhead`; `Attack.landingTile`,
  `Attack.lossFactor`; `world.boats`; events `boatLaunched/Landed/Recalled/Returned`,
  `attackStarted.landingTile`; frame `boats` (snapshot made once per boat).
- **AI (`ai/bot.ts`, `ai/build.ts`):** no open land next to it → one settling boat to the
  nearest unclaimed coast within 300 tiles; no land target worth it → a sea target with the
  land estimate × 0.7; one attacking boat at a time; mobilizes before boat attacks. Nations
  build one Port (income + 0.2 × capacity per unit of boat speed) and upgrade it. Tribes
  stay on land.
- **Client:** `client/app/boats.ts` (chips, preview, `needsBoat`, positions),
  `render/boats.ts` (hulls, routes, preview), Port art in `icons.ts`, Port lines on cards.
- **Tools:** headless `--no-boats`, `--continent`, `navalPerGame` metrics.

## 4. Results (ROADMAP "Milestone 2.7 result")

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

## 5. Known issues / open items

| Item | Where it goes |
|---|---|
| **Ask the user to playtest boats and Ports** (sending, recall, the landing fight, Port prices, how often nations land on them) | start of 2.8 |
| Nations settle islands only once no open land touches them, so the islands go late or to whoever is nearest | 2.10 balance (or let nations settle islands earlier) |
| Bot first-think hitch of ~100 ms once per map in headless workers (sea data built lazily; the browser builds it at map load) | fine; build eagerly if it ever matters |
| Landing = the coast nearest the click; clicking an island's middle can land on its far side | by design (like OpenFront); say so if asked |
| Port III (Naval Base), warships | Phase 2B.6 |
| Aggressors still win few tribe lobbies; turtles strong in 8-nation games | 2.10 balance |
| From earlier: spatial grid for buildings; no gold column on the leaderboard; EndCard team path; Renew-click glitch; large-map perf | see PHASE_2_AFTER_2.4/2.6 handoffs |
| Shell gotcha (still true): long inline scripts with backticks/quotes fail in the Bash tool — write them to the scratchpad and run `node file.cjs` | — |
| Ports 5173–5178 were held by other chats; `.claude/launch.json` now has `dev-7` (5181). In the browser pane, `import("/src/…")` of a module that HMR has updated needs its `?t=` URL (see `performance.getEntriesByType("resource")`) or you get a second, empty copy | — |

## 6. Next steps — milestone 2.8 (ROADMAP row 2.8)

Bigger maps for big lobbies; real-world maps via our own pipeline (public-domain data)
and/or CC BY-SA maps (attribution); `WorkerHost` (simulation off the main thread); re-check
building spacing, Port range and boat speed on bigger maps. Start by asking the user how
boats feel (and whether islands should be settled earlier by nations).

## 7. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2_AFTER_2.7_HANDOFF.md`, then the docs it lists, and continue
> Phase 2 with milestone 2.8 (more maps). Follow the working agreements in the Phase 1
> handoff.
