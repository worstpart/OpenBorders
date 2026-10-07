# Phase 2 handoff (after milestone 2.8)

> **For the next session: read this file first**, then
> [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md) §4–§6 (how the user wants us to work,
> environment gotchas, repo map — all still valid; the debug hook is
> `window.__openborder`). Written 2026-10-06. Last code commit: "Phase 2.8 (part 2): map
> types, Huge size, new map each game, WorkerHost".

## 1. Where we are

| | |
|---|---|
| Phase 1 | ✅ tag `phase-1` |
| Phase 2 done | 2.0 big lobbies · 2.1 Tribes & Nations · 2.2 alliances · 2.3 teams · 2.4 economy · 2.5 buildings · 2.6 walls · 2.7 islands, boats, Ports · **2.8 trade ships + map types/sizes + WorkerHost** |
| Next | ⬜ **2.9 sound & game events** (ROADMAP row 2.9: first sound pass; pings & emotes; a reusable "incoming threat" warning used by boats now, flights/missiles in 2B) |
| Then | 2.10 Phase 2 playtest & balance · **Phase 2B air & strategic warfare (before multiplayer, bots first)** · Phase 3 multiplayer |
| Parked | **Real-world maps** (D-026): user said "no real maps yet"; their picks for later — World, Europe, North America, East Asia, nations with real country names at real places; source undecided (ROADMAP "Parked") |
| Tests | 316 passing, type check clean, Prettier clean, `npm run build` OK (both workers bundled) |
| Regression | `--no-boats --continent` reproduces 2.6 exactly (8-nation lobbies, measured again in 2.8) |

GitHub: `origin` = https://github.com/worstpart/OpenBorders.git (branch `main`). After every
handoff: commit, push, confirm `main` = `origin/main` to the user.

## 2. What happened in 2.8

1. Asked the user first (as 2.7's handoff said): how boats feel, where real-world maps
   should come from, which ones, and who the nations are on them. Answers: **boats feel
   good**; **"we need ports to bring in income" → trade ships like OpenFront**, warships
   capturing non-allied trade later (allies immune); **"No real maps yet"** (but picked
   World/Europe/North America/East Asia + real country names for later). → D-026: trade
   ships built first in 2.8, warship piracy in 2B.6, real maps parked.
2. Part 1 (commit `0d237ef`): trade ships — sim, AI valuation, rendering, floaters, Port
   card, headless metrics.
3. Part 2 (commit `0ba8f8f`): map types and sizes, "Map #N" + 🎲, map generation in a
   worker, `WorkerHost`, coarse-guided sea routes, nations' sea reach scaled by map size.
4. Browser-checked; fixed what the browser showed: trade ships were specks on dark water
   (bigger, light rim); the start card vanished while a new map generated (now stays, Play
   says "Generating map…").

## 3. As built (details: GAME_DESIGN §3.2 + §3.19, ARCHITECTURE §5.6 "WorkerHost as built", §5.7 "Trade ships", §11)

- **Trade ships (`systems/trade.ts`):** every finished Port sends a ship on its own beat
  (Port I / 20 s, Naval Port / 10 s) to a random other living player's finished Port on the
  same sea; both earn `min(6,000, 400 + 10 × route tiles)` when it docks (the destination
  Port's *current* owner receives; none if it is the sender's own now; lost if the Port is
  gone or the sender eliminated). At most 200 at sea. Harbour income cut to +5/+15. Routes
  cached per Port pair. `world.tradeShips`, `player.tradeGold`, event `tradeDocked`, frame
  `tradeShips`. Owner/destination mutable for 2B.6 capture. Nations value Ports with
  `expectedTradePerTick`. Headless `--no-trade`, `naval.tradeTrips/tradeGold/tradeLost`.
- **Client:** small hulls with a gold dot and light rim (`render/boats.ts tradeHull`),
  "+gold" floaters over your Port (`TradeEffect`, small `LootFloater`), Port card lines
  "A trade ship every 20 s", "Trades with N other Ports", "Your trade so far".
- **Maps (`sim/map/generate.ts`):** `generateMap({seed,width,height,style})`; styles
  `continent` (= `generateContinent`, golden-pinned), `archipelago`, `twin`
  (`generateLandmasses`: multi-centre falloff + straits cut where centres meet, along a
  noise-wobbled boundary); `MAP_DIMENSIONS` normal 1100×700, large 1560×990, huge
  2200×1400. `tools/maps.ts <dir> [size] [seeds]` writes PNG previews + stats.
- **Start screen:** Map (Continent · Islands · Two lands), Size (Normal · Large · Huge),
  "Map #N" + 🎲 New map (classic map = #2); amber hint suggests Large/Huge for big lobbies.
- **Workers (`src/host/`):** `mapGeneration.ts` + `mapWorker.ts` (maps off-thread);
  `workerHost.ts` + `simWorker.ts` + `workerProtocol.ts` (`FrameSlimmer`/`FrameRestorer`).
  The client uses WorkerHost whenever `Worker` exists (LocalHost otherwise); tests and the
  headless runner use LocalHost (manual clock). Debug hook unchanged (`send`, `sendAs`,
  `frame()`, `pause()` all go through the worker).
- **Sea routes (`naval.ts`):** exact same-sea check first (instant "no route"), then A* with
  a coarse 8×8-block distance field (LRU of 64 per map) as the estimate.
- **AI:** `seaReach` × max(1, √(map tiles / reference tiles)).

## 4. Results (ROADMAP "Milestone 2.8 result")

| Headless | Median (longest) | Notes |
|---|---|---|
| 8 nations, `--no-boats --continent` (100) | 7.7 min | identical to 2.6/2.7 |
| 8 nations (100) | 8.5 min (2.7: 8.4) | 191 trade trips/game, trade ~22% of gold |
| 10 nations + 100 tribes (50) | 12.7 min (2.7: 13.4) | |
| 8 nations, Islands (50) | **20.5 min** (35.9) | long: every war is a landing |
| 8 nations, Two lands (50) | 14.7 min | |
| 15 + 110, Large (30) | 17.0 min | |
| 25 + 100, Huge (4) | 25.2 min | tick 2.8 avg / 18 p99 ms (in a worker) |

0 errors, every game has a winner. Browser: Huge with 126 players at 4× → 165 fps, 1.5 ms
CPU per frame.

## 5. Known issues / open items

| Item | Where it goes |
|---|---|
| **Ask the user to playtest trade ships and the new maps** (Islands, Two lands, Huge, 🎲) — and whether trade income feels right | start of 2.9 |
| Islands games are long (20.5 min median, 8 nations) | 2.10 balance (e.g. faster boats on Islands, or nations attacking by sea sooner) |
| Nations build only one Port; no embargo; trade with enemies too (like OpenFront) | 2.10 / later if asked |
| First-time trade routes on Huge cost up to ~40 ms in the worker (cached after) | fine; precompute if it ever matters |
| Bot first-think hitch (~80–130 ms) once per map in headless workers | fine (browser builds sea data at map load) |
| Nations settle islands only when no open land touches them | 2.10 balance |
| Real-world maps | parked (D-026) — ask the user when to schedule |
| From earlier: spatial grid for buildings; no gold column on the leaderboard; EndCard team path; Renew-click glitch | see PHASE_2_AFTER_2.4/2.6 handoffs |
| Shell gotchas (still true): long inline scripts with backticks/quotes fail — write them to the scratchpad and run `node file.cjs < /dev/null`; **`cat > file` with no heredoc hangs** | — |
| Ports: 5181 (`dev-7`) and 5173–5177 were held by other chats this time; I used **`dev-6` (5178)**. Another chat's dev server watches this folder, so edits hot-reload there too | — |

## 6. Next steps — milestone 2.9 (ROADMAP row 2.9)

Sound & game events (first pass), pings & emotes, and a reusable "incoming threat"
warning (boats now; flights and missiles in 2B). Start by asking the user to playtest
trade ships and the new maps, and how much sound they want (and whether sounds should be
our own generated ones — OpenFront's sounds are all-rights-reserved, D-001).

## 7. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2_AFTER_2.8_HANDOFF.md`, then the docs it lists, and continue
> Phase 2 with milestone 2.9 (sound & game events). Follow the working agreements in the
> Phase 1 handoff.
