# Phase 2B handoff — air & strategic warfare built (2B.0 – 2B.6)

> **For the next session: read this file first.** It replaces
> [`PHASE_2B_AFTER_2B.5_HANDOFF.md`](PHASE_2B_AFTER_2B.5_HANDOFF.md). The **working agreements
> (§4), environment facts (§5) and repository map (§6) of
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md) still apply** — read those sections too; §4–§5 below
> only add to them. Written 2026-10-14. The repo docs are the source of truth, not chat history.

---

## 1. Where we are

| | |
|---|---|
| Phase 1, Phase 2 | ✅ tags `phase-1`, `phase-2` |
| 2B.0 – 2B.5 (flights, icon-pack art, Airport I–III, SAM I–III, flak, strikes, Missile Silo I–III, D-029, D-030, explosion particles) | ✅ |
| **2B.6 Port III Naval Base + balance pass** | ✅ 169bee0 (ROADMAP "Milestone 2B.6 result", GAME_DESIGN §3.18.1, ARCHITECTURE §5.7 "Warships", D-031) |
| **Phase 2B** | **Built — awaiting the user's playtest approval.** No `phase-2b` tag until they approve (Phase 2 was tagged after the user played it) |
| Next | ⬜ Phase 2B playtest → tag `phase-2b` → **Phase 3 multiplayer** (starts with decision D-006) |
| Tests | 489 passing, type check clean, Prettier clean, build OK |

## 2. What happened this session (2B.6)

- **Asked the user** (2026-10-14) how warships work. Their choices (D-031): **automatic patrol**
  (no steering); warships attack **troop boats, warships and trade ships** of non-friends;
  **I write an image prompt** for their art tool → `docs/art/WARSHIP_ART_PROMPT.md` (sent to
  them). Until the sheet arrives the map draws the Modern troop boat in grey; the Port card says
  it is a stand-in.
- Built bots-first: `systems/warships.ts` (fleets, patrol, prey, guns, capture), coastal
  fortification (virtual: `coastFortLevel` in buildings.ts feeds `walls.ts workingFort`), Port
  level III in `rules.ts` (gated by `rules.warships.enabled`), nation valuation and boat
  avoidance, headless counters (`--no-warships`), then the HUD (map, shells, toasts, card, coast
  line, attack preview, leaderboard goal).
- **Decided by me** (minor, in D-031): trade ships bound for a Port of the owner's or a
  friend's are never captured (first headless run: ~180 captures a game — warships were seizing
  their own trading partners); team games need **85%** (were ending with the land race);
  `navalBaseWorth` 0.15 (at 0.3 nations stopped building Silos/Air Bases).
- Playtest of 2B.4 + 2B.5 was asked again at the start — **no answer yet**.

## 3. Start of the next session

1. **Ask the user to playtest Phase 2B** (one combined, short list — they haven't answered for
   2B.4/2B.5 yet). Islands, as you like:
   - an **airborne assault** that the enemy counter-attacks (D-029: the landing should survive
     and be taken tile by tile), and an **air strike** on buildings;
   - a **Missile Silo**: a strike missile on a cluster, two bunker busters at once through a
     SAM II, the warhead in a long game;
   - a **Port → Naval Base** (~470k): watch the two warships patrol, try to land on an enemy's
     Naval Base coast (your boat should be sunk, or the landing should be slow on the stone
     line), see a passing trade ship captured;
   - one **team game** (it should now last ~9 min instead of ~5).
   Report: missiles too strong/weak for the price? warhead fair? explosions too much/little?
   warships too strong/weak? does the coastal wall feel right? Do games feel too long now?
   **On approval:** tag `phase-2b` on the approving commit, push the tag, confirm.
2. **Warship art:** when the user sends the sheet, save it as
   `openborder_icon_pack_final/sheets/warships.png`, add three `warship-1..3` boxes to
   `SHEET_SPRITES` in `tools/iconPack.mjs` (measure the boxes on the sheet like the second
   sheet), run the tool, check `FACES_LEFT.warship` against the art's bow direction, and
   remove the stand-in note in `client/app/buildings.ts` `fleetLines`. The map uses level 3
   (all warships come from a Naval Base); the other two are spare. `hasSprite("warship", 3)`
   switches the renderer over automatically.
3. **Then Phase 3 (multiplayer):** ROADMAP "Phase 3"; D-006 (multiplayer model) is still
   open — present WHAT / WHY / OPTIONS / RECOMMENDATION (ARCHITECTURE §7 recommends C) before
   any code.

## 4. How the user wants us to work (additions to PHASE_2_HANDOFF §4)

- Unchanged: lead, explain plainly, ask only on decisions that change the game; place every
  request in the right milestone first; no fake systems (stand-ins labelled); verify in the
  browser; push + confirm after each handoff.
- The user answers questions when they are concrete multiple-choice (this session's three
  warship questions were answered at once).
- Art: everything in the user's icon-pack style; new art comes from **their** tool — I write
  the prompt (`docs/art/`).

## 5. Things to know (additions to PHASE_2_HANDOFF §5)

| Fact | Detail |
|---|---|
| Warship code | `systems/warships.ts`: `advanceWarships` (step 2a), `keepFleets`, `seaTargets`/`choosePrey`, `fire`, `capture`, `patrolTiles` (cached per map), `guardedWaters` (for the AI), `warshipTile`/`tradeShipTile`, `NAVAL_BASE_LEVEL` 3. Rules: `rules.warships`, Port level 3 `warships`/`patrolRange`/`coastFort`, `ai.build.navalBaseWorth`, `victory.teamLandShare` |
| Hash | `world.warships` hashed only once `nextWarshipId > 1`; `captured` only when true. Warships-off free-for-all games replay 3ebaaaa (2B.5) exactly; team games differ by design (85%). The next regression baseline is 169bee0 |
| Headless (final) | Islands 20.6 min, 2.7 Naval Bases, 2.8 captures, 0.7 Silos; Continent 8.8; Two lands 10.1; Islands 2 teams 9.3; 10 nations + 100 tribes 10.8. Nations rarely sink boats: they avoid guarded waters (warships deter) |
| Browser test that worked | Islands, Easy, **0 tribes**, 7 nations; spawn at tile 41419 (`sendAs` alliance requests from nations 2–7, `send` the replies, an interval of `sendAs` gold donations + neutral attacks), Port → III at the nearest coast tile; `sendAs(8, boat → your coast)` to get a boat sunk. **Ally every nation but one** (allying only four got me eliminated once). Poll events at 0.5× speed every 20 ms, or frames are skipped and events missed. The map seed can change after a reload |
| Hot reloads | Any edit under `src/sim` **or** `src/client/render` reloads the page and ends the test game — finish browser checks before editing |
| Dev server | this session used **`dev-6` (port 5178)**, left running |
| Particles | The warship shell reuses the SAM shot streak (`shotEffects`) and the `intercept` / `destroyed` particle presets |

## 6. Repository map (additions)

```
src/sim/systems/warships.ts   Naval Base fleets, patrol, guns, capture (2B.6)
tests/sim/warships.test.ts    15 tests: fleet, friends/foes, capture, duel, scuttle, coast fort
docs/art/WARSHIP_ART_PROMPT.md  the image prompt for the user's warship sheet
```

## 7. Known issues / open items

| Item | Where it goes |
|---|---|
| Warship art is a stand-in (grey troop boat) | when the user's sheet arrives (§3.2) |
| Nations almost never lose boats to warships (they avoid guarded waters) — warships mostly matter against humans | watch in the playtest |
| Islands free-for-alls 20.6 min — at the top of the 15–20 min band | the user said longer games are fine; revisit if the playtest says "too long" |
| Air content is rare in bot games (Air Bases ~0.1, strikes ~0.4 a game on Islands) | by design so far (late, expensive); revisit after the playtest |
| Two lands p99 tick ~24 ms in the final run (the machine was busy; warships ≤ 1.6 ms worst) | recheck on a quiet machine if it repeats |
| D-006 multiplayer model | Phase 3 start |
| Phase 2 leftovers (gold column, edge arrows under the leaderboard, fuller sound, real maps) | Phase 4 / parked |

## 8. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2B_HANDOFF.md` (and the sections of `PHASE_2_HANDOFF.md` it points
> to). Ask me for the Phase 2B playtest, then follow the working agreements.
