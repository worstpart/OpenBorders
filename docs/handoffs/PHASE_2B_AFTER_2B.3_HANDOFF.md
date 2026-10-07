# Phase 2B handoff — after milestone 2B.3 (Airport II airborne assault)

> **For the next session: read this file first.** It replaces
> [`PHASE_2B_AFTER_2B.2_HANDOFF.md`](PHASE_2B_AFTER_2B.2_HANDOFF.md); the **working
> agreements (§4), environment facts (§5) and repository map (§6) of
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md) still apply** — read those sections too.
> Written 2026-10-07. The repo docs are the source of truth, not chat history.

---

## 1. Where we are

| | |
|---|---|
| Phase 2 | ✅ tag `phase-2` |
| 2B.0 flights · 2B.0b art · 2B.1 Airport I + airlift · 2B.2 SAM I–III | ✅ |
| **2B.3 Airport II airborne assault + Fortress Wall flak** | ✅ commit c1c2afd "Phase 2B.3: …" (ROADMAP "Milestone 2B.3 result") |
| **Next** | ⬜ **2B.4 — Airport III air strikes** |
| Tests | 414 passing, type check clean, Prettier clean, build OK |
| Regression | the 18 seed-by-seed games replay 2B.2 exactly with flights **off**; with flights on they differ (nations now build Airports for assaults) |

## 2. What happened this session

- The user asked to start 2B.3 and follow the working agreements. **Playtest answers for
  2B.1 + 2B.2 are still outstanding** — the request was repeated in the reply together with
  2B.3's. Ask again at the start of the next session (§3).
- Built the airborne assault end to end (sim, nations, HUD, toasts, helicopters) and defined
  **Fortress Wall flak** (the design only named it) — details in ROADMAP "Milestone 2B.3
  result", GAME_DESIGN §3.17.7 "As built (2B.3)" and §3.17.6, ARCHITECTURE §5.7.
- Minor decisions (recorded in ROADMAP): airlift and assault share one cooldown; an assault
  lands exactly where clicked; landing on a friend's land flies back; flak = one plane per
  wall per entry into its 3 km reach, no reload; the hover card / boat preview hide while
  aiming a lift (bug found in the browser: it offered a boat over enemy land).
- AI tuning story worth knowing: assaults as a *fallback* were never used on the Continent →
  they now compete with the best land target by score; Airports valued for *any* enemy in
  reach were built and never used → now only while an enemy is weak enough for one lift.
  Continent nations still reach an Airport only in a game's last minute (harmless).

## 3. Start of the next session

1. **Ask the user to playtest 2B.1 + 2B.2 + 2B.3** (working agreement), short and plain:
   - Play **Teams** with 4 teams on **Islands** (Easy is fine; 2-team games end in ~6 min,
     too fast to reach a Military Airport). Teammates can gift gold.
   - Build an **Airport** (needs flat land), then **upgrade it** (Military Airport, ~375k).
     Its card has **"🪂 Airborne assault"**: click it, then enemy land inside the dashed ring.
     Helicopters fly there and the troops attack from where they land.
   - Try it on an enemy that is **busy fighting someone else** (or low on troops) — against a
     full army the chip will say "Hopeless" (by design).
   - Also: a **SAM** (press **V** for every SAM's range), and a **Fortress Wall** (a wall
     upgraded twice) shoots down one enemy plane when they fly over it.
   - Report: is the assault understandable and fun, too strong/weak, too expensive; are
     helicopters readable; do the rings / V view / toasts help; is the wider build bar fine.
2. **2B.4 — Airport III air strikes** (ROADMAP row): Air Base (+700k, 25 s; 350 km, lifts 20%,
   20 s; strike cooldown 30 s in its own mission slot — slot 0 is the lift), fighter wings
   (3 tiles/tick; `planeSpeed("fighter")` exists), strike on a building (−1 level and disabled
   20 s if ≥ 2 fighters arrive; 1 fighter: disabled only — `damageBuilding` from 2.5) or on a
   point (suppression 30 s in 10 km: fortification off, attackers lose ×0.8 — the zone-modifier
   hook from 2.6), 2 escort fighters on transports that absorb the first interceptors
   ("escorts targeted first", §3.17.7). AI: strike SAMs/walls before assaults, strike prime
   targets. Art: the pack has planes by era; fighters may need art — ask the user if the
   existing plane sprites don't fit.

## 4. Things to know

| Fact | Detail |
|---|---|
| Assault code | `systems/flights.ts`: `ASSAULT_LEVEL`, `assaultProblem`, `applyAssault`, `landAssault`, `flakFlights` / `flakWallsNear`, `assaultSite` + `quietSite` (shared with `airliftSite`). `naval.ts` `hostileTarget` is exported. AI: `ai/bot.ts` `chooseAirTarget` / `readyMilitaryAirport` (Choice has `score`, `airport`), `ai/build.ts` `assaultProspect` / `assaultValue` |
| Rules | airport level II; `rules.flights.assaultPlanes` 4, `airborneLoss` 1.25; Fortress Wall `flakRadius` 3; `rules.ai.airPreference` 0.6; `rules.ai.build.assaultWorth` 0.15 |
| Headless | `airPerGame` adds `airportUpgrades`, `assaults`, `assaultTroops`, `assaultsLanded`, `assaultTiles`, `flakShots`. Islands FFA 0.7 assaults/game, median 21.9 min (2B.2: 20.4), no game > 30 min; Continent 0 assaults, 8.8 (8.9); Two lands teams 6.4 (6.4). Bots never lose planes (they route around SAMs) |
| Regression script | scratchpad `regress.sh` (same as 2B.2: hashDigest on this checkout and on `git worktree add <scratchpad>/wt-prev HEAD`, flights off and on, `cmp`). The scratchpad is per session — recreate it. **Remove the worktree** at the end (`git worktree remove`) |
| Trace script | a scratchpad `trace.mjs` that plays Continent games and logs Airport builds and assaults per nation was the fastest way to see why the AI didn't use them |
| Browser test that works | Teams, **4 teams, 15 nations**, Islands, Easy; spawn by script on a tile whose ±14 tiles are plains (`ui.map` from `import("/src/client/app/uiState.svelte.ts")`; tile 39471 on map #2); ally every other-team nation by `sendAs(n, {type:"allianceRequest", target:1})` + `send({type:"allianceRequest", target:n})` so you survive; an interval gifts teammates' gold and builds/upgrades the Airport at 3× speed. Break one alliance to get a target in range |
| Browser gotchas (new) | **Any edit to a sim file (even a comment in rules.ts) reloads the page and ends the test game** — finish browser checks before touching `src/sim`. A 2-team game ends at ~6 min and freezes everything (phase "ended"). The imported `ui` module's `friends` can be stale — read alliances from `__openborder.frame()` instead |
| Shell | backticks inside `node -e "…"` ran as commands again (blanked a word in a comment — fixed). Use the scratchpad `patch.cjs` + spec files (`[[file, [[old, new], …]], …]`) for multi-line edits |
| Dev server | this session used **`dev-6` (port 5178)**, left running; another chat's `dev-5` (5177) watches the same folder |

## 5. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2B_AFTER_2B.3_HANDOFF.md` (and the sections of
> `PHASE_2_HANDOFF.md` it points to), then start milestone 2B.4 (Airport III air strikes).
> Follow the working agreements.
