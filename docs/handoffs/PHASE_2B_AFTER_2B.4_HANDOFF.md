# Phase 2B handoff — after milestone 2B.4 (Airport III air strikes)

> **For the next session: read this file first.** It replaces
> [`PHASE_2B_AFTER_2B.3_HANDOFF.md`](PHASE_2B_AFTER_2B.3_HANDOFF.md); the **working
> agreements (§4), environment facts (§5) and repository map (§6) of
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md) still apply** — read those sections too.
> Written 2026-10-12. The repo docs are the source of truth, not chat history.

---

## 1. Where we are

| | |
|---|---|
| Phase 2 | ✅ tag `phase-2` |
| 2B.0 flights · 2B.0b art · 2B.1 Airport I · 2B.2 SAM · 2B.3 Airport II + flak | ✅ |
| **2B.4 Airport III air strikes, suppression, escorts** | ✅ code 8e08bdd; playtest fix + docs + this handoff in the next commit (ROADMAP "Milestone 2B.4 result") |
| **D-029** (user, playtest of 2B.4) | Landed armies (airborne **and boats**) never collide with counter-attacks; the pocket must be taken tile by tile |
| **Next** | ⬜ **2B.5 — Missile Silo I–III** (ROADMAP row) |
| Tests | 442 passing, type check clean, Prettier clean, build OK |

## 2. What happened this session

- Built 2B.4 end to end — details in ROADMAP "Milestone 2B.4 result", GAME_DESIGN §3.17.7
  "As built (2B.4)", ARCHITECTURE §5.7 "Air strikes, suppression, escorts".
- The handoff's notes "`damageBuilding` from 2.5" and "zone-modifier hook from 2.6" were
  **wrong**: neither existed. Built them now: `buildings.ts` `strikeBuilding` / `working` /
  `disabledLeft`, and `systems/suppression.ts` (`isSuppressed` plugged into the wall hooks via
  `walls.ts` `workingFort`, into `tileCost`, and into flak). **2B.5 missiles should reuse
  both** (a strike missile = `strikeBuilding` on every building within 8 km + `suppress`).
- The user **played 2B.4** in the browser and reported: a landed airborne army was swallowed
  the moment the enemy attacked back ("as soon as they click on you after the cooldown all
  progress clears instantly"; "anixsation" = annexation). Cause: `resolveCollisions` cancels
  opposite attacks anywhere on the map, then the unprotected pocket was encircled. Fixed by
  D-029 (also covers boats). The user then asked for this handoff.
- **Playtest answers for 2B.1–2B.3 are still not given explicitly**; the user has now played
  airborne assaults and strikes (they work; the only complaint was D-029). Ask at the start of
  2B.5 whether 2B.4 + the fix feel right.

## 3. Start of the next session

1. **Ask the user to playtest the D-029 fix + air strikes** (short): land an airborne assault,
   let the enemy counter-attack — your landed army should keep fighting, and the enemy has to
   eat the pocket tile by tile; try an air strike on a building and on walled land (orange
   zone). Report: does landing feel fair now, are strikes understandable/too strong, is the
   Air Base reachable (it costs ~1.4M in total; it's a late-game asset by design).
2. **2B.5 — Missile Silo I–III** (ROADMAP row; GAME_DESIGN §3.17.8 table): Silo 250k / +400k
   / +800k; strike missile (75k per launch; every building within 8 km −1 level, suppression
   30 s), bunker buster (II: −2 levels at the exact target, 2 slots), strategic warhead (III,
   500k, 90 s cooldown: 20 km scorched neutral land, buildings destroyed, home troops lost in
   proportion, breaks an alliance with a struck ally). SAM II intercepts conventional
   missiles, SAM III the warhead + early warning (their upgrade lines say "Later:" today —
   remove that). Factory III war production (airports & silos within 60 km reload 25%
   faster). Missiles fly `planeSpeed("missile")` 3 tiles/tick, 1 "plane". Art: the second
   sheet has silo-1..3, missile-1..3, cruiseMissile, airToGroundMissile, icbm sprites already
   cut (`src/client/assets/icons/`). AI: silos in long games, warheads vs runaway leaders.
   Placement in the game direction is decided (D-021); the scorched-land rule is new — ask the
   user only if it turns out to change the game a lot.

## 4. Things to know

| Fact | Detail |
|---|---|
| Strike code | `systems/flights.ts`: `STRIKE_LEVEL` 3, `STRIKE_SLOT` 1, `strikeProblem`, `applyAirStrike`, `landStrike`, `escortsOf`; `shootDown` takes escorts first. `systems/suppression.ts`. `ai/strike.ts` `decideStrike` (every nation every think, independent of its action). `ai/build.ts` `strikeProspect` |
| Rules | Airport level III (`strikeCooldownTicks` 300, `escorts` 2); `rules.flights` `strikePlanes` 4, `strikeDamagePlanes` 2, `strikeDisableTicks` 200, `suppressionRadius` 10, `suppressionTicks` 300, `suppressedLoss` 0.8; `rules.ai` `strikeSamWeight` 2, `strikeAirportWeight` 1.5, `suppressionWorth` 1, `strikeMinValue` 30k; `rules.ai.build.strikeWorth` 0.5 |
| "Disabled" | `working(b, tick)`: no bonuses, SAM silent, Airport no missions, Port no boat bonus/slots/trade sending. New consumers of a building's effect must check it |
| Hash | `disabledUntil` hashed only once ≥ 0, `escorts` only > 0, suppressions only while any — games without strikes keep their hashes |
| Headless | `airPerGame` adds `airBases`, `strikes`, `strikeLevels`, `strikeKills`, `suppressions`. After D-029: Islands median 23.0 min, 0.2 Air Bases, 1.2 strikes, ~3,600 airborne tiles; Continent 8.6; Two lands teams 5.4. Nations rarely reach an Air Base — its price (~1.05M with escalation) is the barrier, not its valuation (0.5 vs 1.0 made no difference) |
| Regression | Before D-029 flights-off games replayed 2B.3 exactly. **D-029 changes boat games on purpose**, so the next regression baseline is this commit. Scratchpad `regress.sh` (hashDigest on this checkout vs `git worktree add <scratchpad>/wt-prev HEAD`, flights off and on) must be recreated per session; remove the worktree after |
| Browser test that worked | Teams, 4 teams, 15 nations, **0 tribes** (a tribe killed the test player once), Islands, Easy; spawn by script at tile 39471 (map #2); ally every other-team bot via `sendAs(n, {type:"allianceRequest", target:1})` + `send(...)`; an interval that **renews alliances** (they expire after 5 min — that killed the first test), makes every nation donate gold to you until the Air Base is done (~70 s at 3× speed), and builds/upgrades the Airport at tile 39471. Then give an enemy gold (`send donate`) and `sendAs` it to build/upgrade a Factory in range, break the alliance, and strike via the card |
| Browser gotchas (new) | When the pane is hidden the viewport can be **0×0** (HUD can't lay out, `screenOf` is garbage): `resize_window` 1280×720 on your tab fixes it (cleared at turn end; reset to desktop after). `look(tile, factor)` zoom is capped — small sprites (escorts) are hard to see in screenshots; pause with `__openborder.pause()` before looking at a moving flight |
| Shell | Write multi-line patches as a JS generator file (Write tool) that outputs a spec for scratchpad `patch.cjs` — heredocs with quotes/backticks failed again |
| Dev server | this session used **`dev-7` (port 5181)**, left running; `dev-6` (5178) belonged to another chat |

## 5. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2B_AFTER_2B.4_HANDOFF.md` (and the sections of
> `PHASE_2_HANDOFF.md` it points to), then start milestone 2B.5 (Missile Silo I–III).
> Follow the working agreements.
