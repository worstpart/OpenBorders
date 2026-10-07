# Phase 2B handoff — after milestone 2B.2 (SAM I–III)

> **For the next session: read this file first.** It replaces
> [`PHASE_2B_AFTER_2B.1_HANDOFF.md`](PHASE_2B_AFTER_2B.1_HANDOFF.md); the **working
> agreements (§4), environment facts (§5) and repository map (§6) of
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md) still apply** — read those sections too.
> Written 2026-10-07. The repo docs are the source of truth, not chat history.

---

## 1. Where we are

| | |
|---|---|
| Phase 2 | ✅ tag `phase-2` |
| 2B.0 flights · 2B.0b art · 2B.1 Airport I + airlift | ✅ |
| **2B.2 SAM I–III** | ✅ commit "Phase 2B.2: …" (ROADMAP "Milestone 2B.2 result") |
| **Next** | ⬜ **2B.3 — Airport II airborne assault** (helicopter art `helicopter-1..3` is ready) |
| Tests | 392 passing, type check clean, Prettier clean, build OK |
| Regression | the 18 seed-by-seed games replay 2B.1 exactly with flights **off and on** |

## 2. What happened this session

- The user asked to start 2B.2 and follow the working agreements. **The 2B.1 playtest
  request was made again in the reply** — no playtest answers have come in yet for 2B.1 or
  2B.2. Ask for both at the start of the next session (§3).
- Built SAM I–III end to end (sim rule, nations, HUD, map, toasts) — details in ROADMAP
  "Milestone 2B.2 result", GAME_DESIGN §3.17.7 "As built (2B.2)", ARCHITECTURE §5.7 "SAMs".
- Decided by me (minor, recorded in ROADMAP): one shot per SAM per tick; a SAM being upgraded
  fires at its old level; missile/warhead/early-warning abilities shown as "Later:" on the
  upgrade; nations build SAMs only under an air threat (max 2); nations route airlifts around
  hostile SAMs; no sound for interceptions (alerts stay rare).
- **Layout change the user should see:** the command panel grew 580 → 620 px and the build
  tiles got a bit more compact (six buildings + wall + the ◎ air defence toggle didn't fit);
  the "Click your land to place…" instruction now has its own line above the tiles (it was
  being squeezed to nothing). Mention it in the playtest.

## 3. Start of the next session

1. **Ask the user to playtest 2B.1 + 2B.2** (working agreement), short and plain:
   - Play **Teams** (Easy is fine). Build an **Airport** (needs plains) and a **SAM Site**
     from the build bar; teammates can gift gold.
   - Click the SAM: its card shows interceptors (green = ready) and its range ring on the map.
     Press **V** (or the ◎ button at the end of the build bar) to see every SAM's range —
     yours light, teammates' blue, enemies' red.
   - Click your Airport → **Airlift troops** → hover a teammate's land: enemy SAM rings
     appear, and a warning if planes would be shot down on that route.
   - Report: are the rings/colours clear, is "V" findable, do the toasts help or annoy, does
     the wider build bar look right, and is the airlift (10% capacity, 30 s, 250 km) useful?
2. **2B.3 — Airport II airborne assault** (ROADMAP row): Airport level II (300 km, 15% lift,
   25 s), hostile landing as a beachhead attack (reuse 2.7's boat landing), ×1.25 airborne
   losses, landing-pocket protection while the attack advances, SAM interception (already
   automatic — any flight kind passes `interceptFlights`), Fortress Wall (III) flak, flights
   of kind `assault` (add to `FlightKind`, `FLIGHT_INFO` hostile: true → incoming-threat
   chips/horn already work), helicopter sprites (`helicopter-1..3`, D-028). AI: assault
   busy/depleted targets, bypass fortified borders — and **SAM value for nations becomes real
   here** (re-check `samWorth` in headless: 2B.2 games shot down 0 planes because no bot
   flight crossed a hostile SAM).

## 4. Things to know

| Fact | Detail |
|---|---|
| SAM code | `systems/flights.ts`: `interceptFlights` (inside `advanceFlights`, before arrivals), `samRadius` / `samInterceptors` / `samReady` / `interceptorsOnRoute` on `SamLike` (building or snapshot); `airliftSite` avoids SAMs. AI: `ai/build.ts` `airDefence` / `samValue` / `bestSamCenter` / `samSite` |
| Rules | `rules.buildings.types.sam` (`range`, `interceptors`, `reloadTicks` per level); `rules.ai.build.samWorth` 0.12, `samThreatMargin` 60, `maxSams` 2 |
| Headless | `airPerGame` now also has `sams`, `samUpgrades`, `planesShotDown`, `troopsShotDown`. Twin teams 0.3 SAMs/game, Continent teams 0.2; game lengths unchanged vs 2B.1 on the same settings (6.6 / 5.1 min median) |
| Regression script | this session used a scratchpad `regress.sh`: for each config (continent 1–5, tribes 1–4, islands 1–5, twinTeams 1–4) run `node tools/hashDigest.mjs <root> <config> <seeds> [rules]` on this checkout and on `git worktree add <scratchpad>/wt-prev HEAD`, with and without `'{"flights":{"enabled":false}}'`, then `cmp` |
| Browser test setup that works | Teams + **Easy** + Islands; spawn by script on a tile whose ±14 tiles are all plains (`ob.send({type:"spawn",tile})`, then `confirmSpawn`); expand gently (attack neutral land with 30% only while home troops > half capacity — 70% attacks got the test player eaten); gold via `ob.sendAs(mate, {type:"donate", to:1, resource:"gold", percentBp:10000})` |
| Browser: test flights | dev builds accept `testFlight {from, to}` — e.g. `ob.sendAs(enemy, {type:"testFlight", from, to})` over your SAM to see a shot. Effects last ~1.2 s; to photograph one, freeze `performance.now` briefly after the `flightIntercepted` event |
| Browser: reloads | editing a plain `.ts` client file (not `.svelte`) reloads the page and ends the game in the pane |
| Shell | `cat > file` **without** a heredoc hangs the Bash tool (happened again). Long patch scripts: write them with the Write tool (a tiny node patcher that replaces strings that must match exactly once, plus a spec file of `[file, [[old, new], …]]`), then run `node patch.cjs spec.cjs < /dev/null` — the scratchpad is per session, so recreate it |
| Dev server | this session used **`dev-5` (port 5177)**, left running |

## 5. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2B_AFTER_2B.2_HANDOFF.md` (and the sections of
> `PHASE_2_HANDOFF.md` it points to), then start milestone 2B.3 (Airport II airborne
> assault). Follow the working agreements.
