# Phase 2B handoff — air & strategic warfare done (2B.0 – 2B.6, approved, + the D-033 fixes)

> **For the next session: read this file first.** It replaces
> [`PHASE_2B_AFTER_2B.5_HANDOFF.md`](PHASE_2B_AFTER_2B.5_HANDOFF.md). The **working agreements
> (§4), environment facts (§5) and repository map (§6) of
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md) still apply** — read those sections too; §4–§6 below
> only add to them. Written 2026-10-14, rewritten 2026-10-16 after the user's 2B.6 playtest
> round (D-032), and again the same day after the Phase 2B approval playtest and its fixes
> (D-033). The repo docs are the source of truth, not chat history.

---

## 1. Where we are

| | |
|---|---|
| Phase 1, Phase 2 | ✅ tags `phase-1`, `phase-2` |
| 2B.0 – 2B.5 (flights, icon-pack art, Airport I–III, SAM I–III, flak, air strikes, Missile Silo I–III, D-029, D-030, explosion particles) | ✅ |
| 2B.6 Port III Naval Base, warships, coastal fortification, balance pass (85% team goal) | ✅ 169bee0 (ROADMAP "Milestone 2B.6 result", GAME_DESIGN §3.18.1, D-031) |
| **2B.6 playtest round** — the user's five requests after playing 2B.6 | ✅ 266eedf (ROADMAP "2B.6 playtest round", D-032) |
| **Phase 2B** | ✅ **Approved** by the user's playtest ("This feels good"), tag `phase-2b` on 09abcc4 (the build they played) |
| **Phase 2B playtest round** — the user's twelve requests with the approval | ✅ the D-033 commit (ROADMAP "Phase 2B playtest round", D-033) |
| Next | ⬜ a short check of the D-033 changes by the user → **Phase 3 multiplayer** (starts with decision D-006) |
| Tests | 490 passing, type check clean, Prettier clean, build OK; `main` = `origin/main` |

## 2. What happened in the last two sessions

**2B.6 (2026-10-14).** I asked the user how warships should work; they chose (D-031) automatic
patrols, warships that attack troop boats, warships and trade ships of non-friends, and an image
prompt from me for the warship art (`docs/art/WARSHIP_ART_PROMPT.md`, sent to them — the grey
Modern troop boat stands in until their sheet arrives). Built bots-first: `systems/warships.ts`,
virtual coastal fortification (`coastFortLevel` → `walls.ts workingFort`), Port level III,
nation valuation, headless counters, then the HUD. My own decisions (D-031): trade ships bound
for the owner's or a friend's Port are never captured; team games need **85%** land (were
ending as the land race did); `navalBaseWorth` 0.15.

**Playtest round (2026-10-15, D-032).** The user played 2B.6 and asked:

| They said | Done |
|---|---|
| "Warships need to be controlled by players, when clicking on their warship you can move it around" | Click your warship (white ring, its patrol circle, a banner), then the sea: it sails there — firing at what comes within gun range, chasing nothing — and patrols and fights within **15 km** of that spot. Esc / right-click deselects; ⚓ marks where each was sent. Unordered warships guard their Base as before. Command `moveWarship` (tile -1 = home) |
| "Warships are too close to shore" | Patrol points keep **4 km** of open water to land (`shoreDistance`, computed while the game loads) |
| "Missiles should destroy bases or suppress them" | Strike missile: buildings within 8 km **−2 levels** (I–II destroyed), the rest out of action **60 s** (was 20), land suppressed 30 s. Bunker buster: **destroys** its building |
| "Missile attacks kill population too" | Strike missile kills **10%** of the victim's home troops, bunker buster **5%** (shown in aiming labels, cards and toasts) |
| "Bots don't use missiles or engage in much combat" | Nations count killed troops in a missile's value and fire at **1.2×** its price (was 2×); `siloWorth` 0.6 (was 0.4); at war one warship **blockades** the enemy's nearest Port (`ai/warship.ts`); expanders and opportunists attack sooner and with a smaller edge (bolder turtles/aggressors tipped Continent games) |

Verified in my own browser tab: a warship selected and sent by clicks, arriving at the spot;
the other patrolling offshore; a strike missile destroying an enemy Housing and killing 64K of
their troops with the toast "🚀 Your strike missile hit 1 building: −2 levels each · 60.9K
troops killed"; no console errors. **The user plays at Medium difficulty.**

**Phase 2B approval playtest (2026-10-16, D-033).** "This feels good", and twelve requests.
I investigated "nations gain a lot of troops with little housing": land gave ~90% of their
capacity and Mobilize turned their gold into troops (1.7M in 12 min for one nation). Three
questions; the user chose craters + blasts, "Housing matters more **and remove Mobilize
entirely**", colour + symbol badges. Done (details: DECISIONS D-033, ROADMAP "Phase 2B
playtest round", GAME_DESIGN §3.16 / §3.17.8 / §3.17.13):

| They said | Done |
|---|---|
| Missiles need splash damage | Strike missile: a 4 km **crater** (enemy land → neutral, 3× to retake for 30 s, troops lost in proportion; standing buildings' tiles spared). Bunker buster: −1 level to every enemy building within 4 km. Circles while aiming and on impact |
| A button to send missiles fast | **Launcher** in the command bar once you own a Silo: 🚀 Missile R · 🎯 Buster T · ☢ Warhead X with the count ready; each click on enemy land fires from the nearest Silo that can; aiming goes on while missiles are left |
| Keys 1 Housing, 2 Factory, 3 Port … | Keys 1–7 = the build bar's order; attack presets moved to Shift+1–5 (numpad 1–5) |
| UI boxes not aligned with text | Build-bar names on one line ("SAM", "Silo"), the key on each tile, a 700 px bar whose row wraps on narrow screens |
| Missiles faster | 60 km/s (was 30) |
| Ports earn too little receiving goods early | Trade 1,000 + 12/tile (was 400 + 10), cap 6,000 |
| Icons unclear | A colour + bold symbol disc per type (map, build bar, card) |
| No hover info over tribes / unclaimed land; clearer hover card | Hidden there; rebuilt with labelled rows, a relation chip and a click box |
| 80% to win | Free-for-all 80% (teams keep 85%); anti-stall reaches 50% at 30 min |
| Level dots zoomed out | Far-zoom dots in the type's colour with one pip per level |
| Nations' troops | Mobilize removed; land capacity −⅓; Housing 2.5× (75k / 225k / 625k); "🏠 +75K" on the troop bar, a Housing row on the hover card |

## 3. Start of the next session

1. **Ask the user for a short check of the D-033 changes** (concrete list): keys 1–7 and
   Shift+1–5; the missile launcher (R, two quick clicks); a crater and a bunker buster's
   splash; the badges and the zoomed-out level dots; the hover card; does Housing now decide
   who has the bigger army, and do they miss Mobilize? Games run ~2 min longer (80%) — too
   long? Fix what they report (tuning → now), then go to step 3.
2. **Warship art** (whenever the user sends the sheet): save it as
   `openborder_icon_pack_final/sheets/warships.png`, add `warship-1..3` boxes to
   `SHEET_SPRITES` in `tools/iconPack.mjs` (measure them on the sheet like the second sheet),
   run the tool, set `FACES_LEFT.warship` to the art's bow direction, remove the stand-in note
   in `client/app/buildings.ts` `fleetLines`. The map uses level 3 (warships only come from a
   Naval Base); `hasSprite("warship", 3)` switches the renderer over by itself.
3. **Then Phase 3 (multiplayer):** write the Phase 2B end in this file's place only if more
   than the tag changes; otherwise start Phase 3 with D-006 (multiplayer model, still open):
   WHAT / WHY / OPTIONS / RECOMMENDATION (ARCHITECTURE §7 recommends C) before any code. The
   new commands of Phase 2B (`airlift`, `assault`, `airStrike`, `launchMissile`,
   `moveWarship`, walls) all go through the same validated command path, so they carry over.

## 4. How the user wants us to work (additions to PHASE_2_HANDOFF §4)

- Unchanged: lead, explain plainly, ask only on decisions that change the game; place every
  request in the right milestone first; no fake systems (stand-ins labelled); run, test and
  verify in the browser before saying it works; push + confirm after each handoff.
- The user gives feedback as short lists after playing ("please improve") — they expect me to
  interpret, decide the details, measure with headless games and say plainly what changed.
  Ambiguous wording ("destroy bases or suppress them"): pick the reasonable reading, say it.
- They answer concrete multiple-choice questions quickly (2B.6's three warship questions).
- They play at **Medium** — tune and measure there, not only at Hard.
- Art: the user's icon-pack style; new art comes from **their** tool — I write the prompt.
- Warn before edits that will reload their game in the browser pane; test in my own tab.

## 5. Things to know (additions to PHASE_2_HANDOFF §5)

| Fact | Detail |
|---|---|
| Warship code | `systems/warships.ts`: `advanceWarships` (tick step 2a), `keepFleets`, `patrolOf` (centre + radius: order 15 / Base 40), `applyMoveWarship`, transit (far from its centre: fire within gun range, no chase), `seaTargets`/`choosePrey`, `fire`, `capture`, `patrolTiles(map, centre, range, offshore)`, `shoreDistance` (per map, precomputed in `createWorld`), `guardedWaters`. Nations: `ai/warship.ts` `decideWarships` (one blockader while at war). Client: `app/boats.ts` `warshipVoyage` / `warshipSize` / `warshipAtPoint`, `ui.selectedWarship`, `render/boats.ts` (ring, patrol circle, ⚓) |
| Missile code | `systems/missiles.ts` `killTroops` (strike / buster); rules `flights.missileLevels` 2, `busterLevels` 3, `missileDisableTicks` 600, `missileTroopShare` 0.1, `busterTroopShare` 0.05; `ai.missileValueFactor` 1.2; `ai.build.siloWorth` 0.6. Texts shared by cards, banner and labels: `client/app/flights.ts` `strikeMissileText` / `busterText` |
| Headless (D-033 rules) | Islands Medium (40): 20.4 min, 370 nation-vs-nation attacks a game, 8.6 missiles, 2.5 Silos, 0 bunker busters (nations never pick one). Islands 2 teams (30): 11.2 min, 13 · 17. Continent Hard (60): 10.1 min, wins expander 14 · turtle 17 · opportunist 15 · aggressor 14 |
| Regression baseline | D-033 changed troops, trade, missiles, victory and the AI, so every game differs; the **D-033 commit** is the next baseline for `tools/hashDigest.mjs` |
| Investigation script | A headless game that prints each nation's land capacity, Housing capacity, troops and gold every 2 min was written to the session scratchpad (not kept); rebuild it from `tools/headless.ts`'s `playOne` if needed |
| D-033 code | Sim: `missiles.ts` `landWithin` / `burnLand` (crater + warhead), `landBuster` splash; `rules.flights.craterRadius/craterTicks/busterSplashRadius/busterSplashLevels`; frame `capacityBonus`. Client: `app/flights.ts` `missileLauncher` / `launcherPreview`, `ui.missileAuto`, `client.ts` `aimMissile` / `pickByKey` / `pendingLaunches`; `icons.ts` `TYPE_COLORS` / `TYPE_GLYPHS` |
| Browser test that worked | Own tab; start screen buttons clicked by text from JS (`0` tribes, `Easy`, `Islands`, `Play`); spawn at tile 41419; `sendAs` alliance requests from nations 2–7 and `send` the replies (**ally all but one** — allying only four got me eliminated once); an interval of `sendAs` gold donations + neutral attacks; Port → III at the nearest coast tile (~45 s at 5×). Click tests: compute the ship's position with `app/boats.ts` (import its resource URL), `look()` there, dispatch `pointerdown`/`pointerup` on `#map` at `screenOf(tile)` — clicks past the map edge are ignored by design. Poll events at ≤ 1× every 20–50 ms or frames are skipped |
| Hot reloads | Any edit under `src/sim` or `src/client/render` reloads the page and ends the test game |
| Machine load | Running several headless batches in parallel next to the browser produced false tick spikes (warships 30–50 ms); run timing-sensitive batches one at a time |
| Dev server | `dev-6` (port 5178), left running |

## 6. Repository map (additions)

```
src/sim/systems/warships.ts     Naval Base fleets, patrol, orders, guns, capture, shore distance (2B.6, D-032)
src/sim/ai/warship.ts           nations' warship orders: one blockader while at war (D-032)
tests/sim/warships.test.ts      19 tests: fleet, friends/foes, capture, duel, scuttle, orders, offshore, coast fort
tests/client/warships.test.ts   clicking your warship
docs/art/WARSHIP_ART_PROMPT.md  the image prompt for the user's warship sheet
```

## 7. Known issues / open items

| Item | Where it goes |
|---|---|
| Warship art is a stand-in (grey troop boat) | when the user's sheet arrives (§3.2) |
| Nations never fire a bunker buster (the strike missile's value wins); Mobilize's removal leaves big gold piles late (up to ~1M) | watch; nation build/missile tuning if the user notices |
| Nations rarely lose boats to warships (they steer around guarded waters) — warships matter most against humans and in blockades | watch in the playtest |
| Air content is still rare in bot games (Air Bases ~0.1, strikes ~0.2 a game on Islands) — nations spend on Silos and Naval Bases | revisit if the playtest says nations never use planes |
| Continent games slightly favour turtles (21/60) | accepted for now; recheck with the next tuning |
| One Islands game in 40 still runs ~39 min (anti-stall ends it) | accepted |
| D-006 multiplayer model | Phase 3 start |
| Phase 2 leftovers (gold column, edge arrows under the leaderboard, fuller sound, real maps) | Phase 4 / parked |

## 8. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2B_HANDOFF.md` (and the sections of `PHASE_2_HANDOFF.md` it points
> to). Ask me for a short check of the D-033 changes, then start Phase 3 with D-006, following
> the working agreements.
