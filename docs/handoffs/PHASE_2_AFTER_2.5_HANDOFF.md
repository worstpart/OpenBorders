# Phase 2 handoff (after milestone 2.5)

> **For the next session: read this file first**, then
> [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md) §4–§6 (how the user wants us to work,
> environment gotchas, repo map — all still valid; the debug hook is
> `window.__openborder`). Written 2026-10-02. Last commit: "Phase 2.5: buildings".

## 1. Where we are

| | |
|---|---|
| Phase 1 | ✅ tag `phase-1` |
| Phase 2 done | 2.0 big lobbies · 2.1 Tribes & Nations · 2.2 alliances · 2.3 teams · 2.4 economy · **2.5 buildings (framework + Housing & Factory I–III)** |
| Next | ⬜ **2.6 Border Defense I–III** (GAME_DESIGN §3.17.6, D-022, ROADMAP row 2.6) |
| Then | 2.7 boats + Port I–II (builds the beachhead attack) · 2.8 maps · 2.9 sound · 2.10 playtest & balance · **Phase 2B air & strategic warfare (before multiplayer, bots first)** · Phase 3 multiplayer |
| Tests | 266 passing, type check clean, Prettier clean |
| Regression | `--no-buildings` games identical to 2.4 |

## 2. The building plan (agreed with the user on 2026-10-02)

The user asked for an OpenFront-style building system with **7 buildings × 3 levels**:
Housing, Factory, Port, Border Defense, SAM, Missile Silo, Airport (airlift → airborne
assault → air strikes). The full design is **GAME_DESIGN §3.17** (21-tier matrix, counters,
economy fit, UI). Decisions:

- **D-021** — three named levels; one definitions table (`rules.buildings`); roadmap 2.5
  framework + Housing/Factory → 2.6 Border Defense → 2.7 boats + Port I–II → **Phase 2B air &
  strategic warfare BEFORE multiplayer** (user), built **bots-first** (nations use airports
  and SAMs in headless/spectated games before the human controls exist).
- **D-022** — Border Defense = a post whose zone fortifies the owner's own land; the owner's
  border inside the zone is drawn as a wall; derived from (posts, ownership) each change.
- **D-023** — only the sender needs an airport; SAMs fire a few interceptors that always
  hit one plane (no dice, no stacking multipliers); level = health; **troop gifts only over
  a shared border or by airlift** (border rule is live since 2.5; gold gifts anywhere).
- The user accepts **longer games** (provisional target ~15–20 min for nations + tribes).
- Clarified with the user: you can attack several enemies at once (one army per enemy, like
  OpenFront); only boat/air landings will become separate armies against the same enemy.

## 3. What 2.5 added (details: GAME_DESIGN §3.17 "As built", ARCHITECTURE §5.7)

- **Sim:** `rules.buildings` (+ `ai.build`), `sim/geometry.ts` (distance / withinRange /
  travelTicks), `systems/buildings.ts` (build, upgrade, cancelBuild; tick step 5b
  `updateBuildings`: captured buildings are **adopted at their level** (user) — tribes
  destroy what they take, unfinished ones are lost —
  completions, per-player `bonus`), events `buildingStarted/Completed/Cancelled/Captured/
  Destroyed`, buildings in the hash and in every frame, `PlayerSnapshot.mobilizeDiscount` /
  `growthBonus`. Mobilize respects the Factory discount (`goldPerTroop`, `mobilizeCost`).
- **AI (`ai/build.ts`):** value-per-gold goal over new buildings and upgrades, savings kept
  out of the war chest by personality, one construction at a time, deep sites.
- **HUD (revised after the user's playtest):** a **build bar** in the command bar
  (`BuildBar.svelte`): click a building, it follows the mouse (`ui.placing`, ghost with a
  green/red spacing ring), click your land to place, right-click or Esc to put it back.
  Icons: SVG art in `client/icons.ts` shared by the map (`render/buildings.ts`, Canvas2D
  Path2D on the label canvas — `LabelLayer.clear()` runs first) and the HUD
  (`BuildingIcon.svelte`); round badges, gold level dots. Click an icon → building card
  (`BuildingCard.svelte`: effects, progress + Cancel, Upgrade with price and gains); toasts
  for finished / captured / destroyed buildings; a "build" hint; "only over a shared border"
  on troop gifts.
- **Tools:** headless `--no-buildings`, per-game builds/upgrades/gold/captures and the minute
  the first L1/L2/L3 finished.

## 4. Results (ROADMAP "Milestone 2.5 result")

After the adoption rule: 8 nations median 7.9 min (2.4: 7.1), wins even (turtle 28 · opp 27
· exp 24 · agg 21); first L1 / L2 / L3 at 1:12 / 2:25 / 6:08. 10 nations + 100 tribes:
13.4 min (2.4: 11.8); turtles 25/50, aggressors 5/50 (watch both). Tick cost ~0.01 ms.

## 5. Known issues / open items

| Item | Where it goes |
|---|---|
| Icon size: 18–40 px (`ICON_*` in `render/buildings.ts`) | adjust if the playtest asks |
| Aggressors rarely win tribe lobbies (2/50) | 2.10 balance (their saving share 40%) |
| The user playtested 2.5: "plays well, pricing is good"; asked for the build bar, new icons and adoption (done). Ask how the new bar feels | start of 2.6 |
| Spatial grid for buildings not built (linear scans are fine today) | 2.6 (zones) / 2B (SAM radii) |
| From earlier: turtles in tribe lobbies; 2-team games decided early; no gold column on the leaderboard; EndCard team path; Renew-click glitch; large-map perf | see PHASE_2_AFTER_2.4_HANDOFF §3 |

## 6. Next steps — milestone 2.6 Border Defense (ROADMAP row 2.6)

1. Add `borderDefense` to `BUILDING_TYPES` with levels (radius 12/16/20, losses ×1.5/2/2.5,
   speed ×0.67/0.5/0.4, `onCapture: "destroy"`); give level rules the zone fields.
2. `world.fortLevel` (Uint8Array, derived): rebuild a post's disc on build/upgrade/
   destroy; update per captured tile; a building spatial grid for "which posts cover this".
3. One zone-modifier hook read by `attacks.ts` (`tileCost`, `layerDelay`) **and** `battle.ts`
   (odds stay true); ASCII tests for every §3.17.6 case (border moves, post captured, two
   fortified players, allies, overlap = best level, neutral expansion unaffected).
4. Rendering: fortLevel texture (R8, dirty uploads) and a wall pattern on fortified border
   edges facing non-friendly owners, by level. Level III flak waits for aircraft (2B).
5. AI: fortify threatened fronts; attack around zones or aim at posts. Headless: turtle wins
   must not get worse than 2.4/2.5, frontal attacks on an L3 line cost ~1.6× the troops.
6. Commit "Phase 2.6: Border Defense".

## 7. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2_AFTER_2.5_HANDOFF.md`, then the docs it lists, and continue
> Phase 2 with milestone 2.6 (Border Defense). Follow the working agreements in the Phase 1
> handoff.
