# Phase 2 handoff (after milestone 2.6)

> **For the next session: read this file first**, then
> [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md) §4–§6 (how the user wants us to work,
> environment gotchas, repo map — all still valid; the debug hook is
> `window.__openborder`). Written 2026-10-02. Last code commit: "Phase 2.6: Border Defense
> as walls drawn point by point (D-024)".

## 1. Where we are

| | |
|---|---|
| Phase 1 | ✅ tag `phase-1` |
| Phase 2 done | 2.0 big lobbies · 2.1 Tribes & Nations · 2.2 alliances · 2.3 teams · 2.4 economy · 2.5 buildings · **2.6 Border Defense = drawn walls** |
| Next | ⬜ **2.7 boats + Port I–II** (ROADMAP row 2.7 — builds the beachhead attack airborne assaults reuse) |
| Then | 2.8 maps · 2.9 sound · 2.10 playtest & balance · **Phase 2B air & strategic warfare (before multiplayer, bots first)** · Phase 3 multiplayer |
| Tests | 283 passing, type check clean, Prettier clean |
| Regression | games with walls off (`ai.build.maxWalls` all 0) identical to 2.5; `--no-buildings` identical to 2.4 |

GitHub: `origin` = https://github.com/worstpart/OpenBorders.git (branch `main`). After every
handoff: commit, push, confirm `main` = `origin/main` to the user.

## 2. What happened in 2.6 (important: the design changed mid-milestone)

1. Built the planned design (D-022): a Border Defense **post** whose circle fortified the
   owner's land; the border inside the zone drawn as a wall by the map shader. Tested and
   measured (a frontal attack on level III needed 1.55× the troops) and shown in the browser.
2. The user then asked: *"i want border walls to place with a point a,b,c, ect until the
   wall shape is built. this wall will be buff and enemies push. similar to clash of clans
   walls and placing."* Asked three questions; the user chose: **walls replace posts**, wall
   tiles are **hard** (go around or break through), walls go **anywhere on your land**.
   Recorded as **D-024** (D-022 superseded). The post code was replaced; nothing of it remains.

## 3. Walls as built (details: GAME_DESIGN §3.17.6, ARCHITECTURE §5.7 "Walls")

- **Player:** build bar → *Wall* (600 gold/tile at level I) → click A, B, C … on your land
  (straight 8-connected pieces; green/red line follows the mouse with "N tiles · price") →
  right-click, Enter or clicking the last point again builds; Esc cancels. ≤ 12 points,
  ≤ 80 tiles; joins existing walls. Click your wall → card (tiles standing, effect,
  Upgrade/Cancel). Hover shows "Your wall / Wall · <name>: holds attacks ~N s per tile".
- **Levels:** Palisade (600/tile, hold 3 s, ×3 + 150 troops) → Stone Wall (+1,500/tile, 6 s,
  ×5 + 500) → Fortress Wall (+4,000/tile, 10 s, ×8 + 1,500). Hold shrinks with the attack's
  speed by √, never below half. The whole wall upgrades; cancelling refunds 50%; escalation
  +25% per 60 wall tile-levels owned (max ×3).
- **Breaking:** any wall tile changing hands breaks at once (`setOwner` → `breakWallTile`);
  the rest stands; last tile → wall gone.
- **Sim:** `src/sim/systems/walls.ts`; `world.walls / wallAt / wallHash / fortLevel /
  fortChanges / wallsVersion`; commands `buildWall`, `upgradeWall`, `cancelWall`; events
  `wallStarted/Completed/Cancelled/Breached/Destroyed`; frame `walls` + `fortTiles/fortLevels`.
- **AI:** `ai/build.ts` — threats (non-friend nation/human attacking, or ≥ 60% of our
  troops), one straight wall 5 tiles behind an unguarded threatened border stretch, ≤ 40
  tiles; max walls turtle 3 / expander 2 / opportunist 2 / aggressor 1; upgrades walls that
  face a threat. `ai/bot.ts` counts walls on the shared front in estimates and aims at an
  open stretch.
- **Client:** walls drawn in Canvas2D (`render/buildings.ts`, `wallRuns`, `wallDraft`), HUD
  logic in `client/app/buildings.ts` (`Placeable` = building type | "wall", `wallPreview`,
  `wallCard`, `wallAtPoint`). Dev hook gained `look(tile, zoomFactor)` and `screenOf(tile)`.

## 4. Results (ROADMAP "Milestone 2.6 result")

8 nations: 7.7 min median (2.5: 7.9), wins turtle 33 · opp 23 · agg 22 · exp 22. 10 nations
+ 100 tribes: 12.9 min (2.5: 13.4); **turtles 13/50** (2.5: 25; target "not worse than 24");
aggressors 3/50 (watch). ~30 walls per game, most eventually broken through.

**After the user's report "nations only build walls" (same day):** far-zoom buildings are
now dots (they were hidden), and nations build walls only after their first Housing or
Factory unless under attack. After the fix: 8 nations 7.7 min (turtle 35); tribe lobbies
12.6 min, turtles 19/50, aggressors 5/50.

## 5. Known issues / open items

| Item | Where it goes |
|---|---|
| **Ask the user to playtest walls** (drawing, strength, prices, look). Not yet seen in the browser: an enemy breaking a gap (tests cover it) | start of 2.7 |
| Aggressors win 3/50 tribe lobbies | 2.10 balance |
| Hold times / prices are first guesses (§3.17.6 table) | tune after the playtest |
| Walls under construction can be broken too (tiles reserved) — by design, say so if asked | — |
| Fortress Wall flak waits for aircraft | Phase 2B |
| Spatial grid for buildings still not built (linear scans fine) | 2B (SAM radii) |
| From earlier: turtles in 8-nation games (33); 2-team games decided early; no gold column on the leaderboard; EndCard team path; Renew-click glitch; large-map perf | see PHASE_2_AFTER_2.4_HANDOFF §3 |
| Shell gotcha this session: long inline `node -e` / heredoc scripts with backticks or `'` failed in the Bash tool — write scripts to the scratchpad with the Write tool and run them | — |
| Ports 5173–5177 were held by other chats; `.claude/launch.json` now has `dev-6` (5178) | — |

## 6. Next steps — milestone 2.7 (ROADMAP row 2.7)

Boats from any coast, routes, ETA, beachheads (an attack whose front starts at a landing
tile and does **not** merge with the land army — ARCHITECTURE §5.7 "Beachhead attacks"),
recall; landing-pocket encirclement protection; Port I–II (faster boats, extra slots,
harbour income, Marines); AI uses boats. Start by asking the user how walls feel.

## 7. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2_AFTER_2.6_HANDOFF.md`, then the docs it lists, and continue
> Phase 2 with milestone 2.7 (boats + Port I–II). Follow the working agreements in the
> Phase 1 handoff.
