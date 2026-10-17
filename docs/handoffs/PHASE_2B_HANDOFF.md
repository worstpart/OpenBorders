# Phase 2B handoff — air & strategic warfare complete; next: Phase 3 multiplayer

> **For the next session: read this file first.** It is the end-of-phase handoff for Phase 2B
> and replaces [`PHASE_2B_AFTER_2B.5_HANDOFF.md`](PHASE_2B_AFTER_2B.5_HANDOFF.md). The
> **working agreements (§4), environment facts (§5) and repository map (§6) of
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md) still apply** — read those sections too; §4–§6
> below only add to them. Written 2026-10-14, rewritten 2026-10-16 at the end of Phase 2B
> (after the approval playtest and its fixes, D-033). The repo docs are the source of truth,
> not chat history.

---

## 1. Where we are

| | |
|---|---|
| Phase 1, Phase 2 | ✅ tags `phase-1`, `phase-2` |
| **Phase 2B** (2B.0 flights · 2B.0b icon-pack art · 2B.1 Airport I · 2B.2 SAM · 2B.3 assault + flak · 2B.4 air strikes · 2B.5 Missile Silo · 2B.6 Naval Base + warships · D-032 playtest round) | ✅ **approved** by the user's playtest 2026-10-16 ("This feels good"); tag **`phase-2b` on 09abcc4** (the build they played) |
| Phase 2B playtest round — the user's twelve requests with the approval | ✅ **4d597f7** (D-033; ROADMAP "Phase 2B playtest round") — **not played by the user yet** |
| Next | ⬜ a short check of D-033 by the user (§3.1) → **Phase 3 — multiplayer**, starting with decision **D-006** (§3.3) |
| Tests | 490 passing (54 files), type check clean, Prettier clean, build OK; `main` = `origin/main` |

## 2. What Phase 2B ended with

Everything the solo game needs: Airports I–III (airlifts to friends, airborne assaults, air
strikes with escorts), SAMs I–III (deterministic interceptors), Fortress Wall flak, Missile
Silos I–III (strike missile, bunker buster, strategic warhead), Port III Naval Base (warships
you can order, coastal fortification, trade capture and blockades), explosion particles, and
the user's icon-pack art. Nations use all of it bots-first (D-021). Decisions D-028 – D-033.

**The last session (2026-10-16).** The user approved Phase 2B and asked for twelve changes.
I investigated "nations gain a lot of troops with little housing" (land gave ~90% of their
capacity; Mobilize turned their gold into troops — 1.7M in 12 min for one nation), asked three
concrete questions, and built D-033:

| They said | Done |
|---|---|
| Missiles need splash damage | Strike missile: a 4 km **crater** (enemy land → neutral, 3× to retake for 30 s, troops lost in proportion; standing buildings' tiles spared so the buster keeps its job). Bunker buster: −1 level to every enemy building within 4 km. Circles while aiming and on impact |
| A button to send missiles fast | **Launcher** in the command bar once you own a Silo: 🚀 Missile R · 🎯 Buster T · ☢ Warhead X with the count ready; each click on enemy land fires from the nearest Silo that can; aiming goes on while missiles are left |
| Keys 1 Housing, 2 Factory, 3 Port … | Keys 1–7 = the build bar's order; attack presets moved to Shift+1–5 (numpad 1–5) |
| UI boxes not aligned with text | Build-bar names on one line ("SAM", "Silo"), the key on each tile, a 700 px bar whose row wraps on narrow screens |
| Missiles faster | 60 km/s (was 30) |
| Ports earn too little receiving goods early | Trade 1,000 + 12/tile (was 400 + 10), cap 6,000 |
| Icons unclear | A colour + bold symbol disc per type (map, build bar, card) |
| No hover info over tribes / unclaimed land; clearer hover card | Hidden there; rebuilt with labelled rows, a relation chip and a click box |
| 80% to win | Free-for-all 80% (teams keep 85%); anti-stall reaches 50% at 30 min |
| Level dots zoomed out | Far-zoom dots in the type's colour with one pip per level |
| Nations' troops (the user chose "Housing matters more **and remove Mobilize entirely**") | Mobilize removed (command, button, key M, Factory discount, war chest); land capacity −⅓; Housing 2.5× (75k / 225k / 625k); "🏠 +75K" on the troop bar, a Housing row on the hover card |

Headless (Medium, the user's level): Islands 20.4 min (was 18.6), 8.6 missiles a game (4.2);
Islands 2 teams 11.2 min (8.5); Continent Hard 10.1 min, wins 14 · 17 · 15 · 14. Verified in
my own browser tab (keys, launcher double-fire, craters, badges, level dots, hover card, no
console errors).

## 3. Start of the next session

### 3.1 First: a short check of D-033 (the user hasn't played it)

Ask for a quick game (Islands, Medium) with a concrete list: keys 1–7 and Shift+1–5; the
launcher (build a Silo, press R, click twice); a crater and a bunker buster's splash; the
badges and the zoomed-out level dots; the hover card. Questions: does Housing now decide who
has the bigger army? Do they miss Mobilize? Are ~20-min games too long? Tuning → fix now; new
systems → roadmap (say where and why). Then §3.3.

### 3.2 Whenever the warship art arrives

Save the sheet as `openborder_icon_pack_final/sheets/warships.png`, add `warship-1..3` boxes to
`SHEET_SPRITES` in `tools/iconPack.mjs` (measure them on the sheet like the second sheet), run
the tool, set `FACES_LEFT.warship` to the art's bow direction, remove the stand-in note in
`client/app/buildings.ts` `fleetLines`. `hasSprite("warship", 3)` switches the renderer over by
itself. The prompt the user has: `docs/art/WARSHIP_ART_PROMPT.md`.

### 3.3 Phase 3 — multiplayer: start with D-006, before any code

D-006 is still **Proposed** (DECISIONS.md; ARCHITECTURE §7). It decides how the server and the
browsers share one game — a major decision, so present it to the user as **WHAT / WHY /
OPTIONS / RECOMMENDATION**, in plain words:

- **What:** who runs the simulation online and what travels over the network.
- **Options:** **A** relay lockstep (OpenFront's way: the server only forwards commands,
  clients vote on outcomes — cheapest, but cheatable and slow to reconnect); **B**
  authoritative server sending state changes (simple, but big games change thousands of
  tiles a tick → heavy bandwidth); **C** hybrid: the server runs the same deterministic
  simulation, validates and forwards commands, compares hashes and repairs a diverging
  client with a snapshot (commands-only bandwidth, the server decides outcomes).
- **Recommendation: C** (ARCHITECTURE §7.2), with B as the fallback if cross-browser
  determinism proves too costly — the host abstraction keeps that switch contained.

Also ask, as concrete multiple-choice questions (they change the plan): **where the server
runs** for testing (your own computer first, two browser tabs / LAN — recommended; or a cloud
host from the start); **how players join** (a lobby link to share — recommended for the
first version — vs public lobbies / matchmaking now); **names** (just a name, no accounts —
recommended); **bots in online games** (fill empty slots with nations and tribes —
recommended). Record the answers as D-006 (accepted) + D-034…, then write the Phase 3
milestones into ROADMAP.

**My proposed milestone order** (bots-first spirit: prove the hard part headless before UI):

| | Milestone | Proves |
|---|---|---|
| 3.0 | **Snapshots + determinism harness** — `serializeWorld` / `deserializeWorld` (every field `hashWorld` covers, plus RNG state, brains, maps such as `lastDonationTick`); round-trip test (snapshot mid-game → continue → identical hash); a command log replayer; the same seeded game in Node and in the browser gives the same hashes tick by tick | that C is viable |
| 3.1 | **Server skeleton** — `src/server/` (Node, one game per worker thread, the sim + a 100 ms turn scheduler, WebSocket — needs a package such as `ws`: ask before adding dependencies) and a `NetworkHost` implementing `SimHost` in `src/host/` (the browser's built-in WebSocket, no package) | two tabs play one game |
| 3.2 | **Lobby by link** — create, share the link, names, ready, start; bots fill | friends can join |
| 3.3 | **Validation & rate limits** — the server stamps the sender, rejects invalid commands (the sim already validates every command), per-player command limits | nobody can cheat or flood |
| 3.4 | **Hash checks, resync, reconnect, spectators** — clients report hashes every N ticks, the server compares with its own and resends a snapshot; reconnect and late join/spectate = snapshot + turns since | robustness |
| 3.5 | **Online feel** — instant pending feedback on clicks (command → next turn ≈ 100–200 ms), teams online, end-of-game, latency indicator | it feels like the solo game |
| 3.6 | **Hosting** (the user's choice) + the multiplayer playtest | Phase 3 approval |

## 4. How the user wants us to work (additions to PHASE_2_HANDOFF §4)

- Unchanged: lead, explain plainly, ask only on decisions that change the game; place every
  request in the right milestone first; no fake systems (stand-ins labelled); run, test and
  verify in the browser before saying it works; push + confirm after each handoff.
- The user gives feedback as short lists after playing ("please improve") — they expect me to
  interpret, decide the details, measure with headless games and say plainly what changed.
  Ambiguous wording: pick the reasonable reading and say it; for game-changing choices ask
  concrete multiple-choice questions (they answer fast, sometimes with a twist — "remove
  Mobilize entirely" came as a free-text answer).
- They play at **Medium** — tune and measure there, not only at Hard.
- Art: the user's icon-pack style; new art comes from **their** tool — I write the prompt.
- Warn before edits that will reload their game in the browser pane; test in my own tab.
- Phase 3 will need new packages (server WebSocket, maybe a browser test runner): say which
  and why before installing.

## 5. Things to know (additions to PHASE_2_HANDOFF §5)

| Fact | Detail |
|---|---|
| Host abstraction (Phase 3's seam) | `src/host/host.ts` `SimHost` (`start`, `send`, `onFrame`, pause/speed for local games only); `LocalHost` (turn = one tick, 100 ms; commands stamped `{playerId, command}` = `StampedCommand`), `WorkerHost` + `simWorker.ts` + `workerProtocol.ts` (frames slimmed for the wire: routes sent once, walls only when changed — a ready model for network frames). Maps generate from a seed in `mapWorker.ts` — a server can regenerate the same map |
| Determinism today | `src/sim` is guard-tested (no `Math.random`, `**`, transcendental `Math`, clocks, DOM, locale); `stateHash.ts` `hashWorld` / `computeOwnerHash`; `tools/hashDigest.mjs` compares seeds between commits. **No world snapshot (serialize/deserialize) exists yet** — milestone 3.0 |
| Import boundaries | `tests/guards/importBoundaries.ts` already defines `server` (may import sim, shared, packages) and `shared`; `host` may not import packages |
| Validation | Every command is validated by the sim when it executes (`tick.ts` `applyCommand`; rejections become `commandRejected` events) — the server reuses that, never trusts client state |
| Commands to carry online | spawn, confirmSpawn, attack, boat, recallBoat, retreat, alliance request/reply/renew/break, donate, build, upgrade, cancelBuild, buildWall, upgradeWall, cancelWall, emote, ping, airlift, assault, airStrike, launchMissile, moveWarship (`testFlight` is dev-only) |
| Missile & warship code | `systems/missiles.ts` (`landWithin` / `burnLand` crater + warhead, `landBuster` splash, `killTroops`); `systems/warships.ts` (orders, patrol, guns, capture, `shoreDistance`); nations `ai/missile.ts`, `ai/warship.ts`. Client launcher: `app/flights.ts` `missileLauncher` / `launcherPreview`, `ui.missileAuto`, `client.ts` `aimMissile` / `pickByKey` / `pendingLaunches`; badges `icons.ts` `TYPE_COLORS` / `TYPE_GLYPHS` |
| Headless (D-033 rules) | Islands Medium (40): 20.4 min, 370 nation-vs-nation attacks a game, 8.6 missiles, 2.5 Silos, 0 bunker busters. Islands 2 teams (30): 11.2 min, 13 · 17. Continent Hard (60): 10.1 min, wins expander 14 · turtle 17 · opportunist 15 · aggressor 14 |
| Regression baseline | **4d597f7** (D-033) for `tools/hashDigest.mjs` — Phase 3 must not change bots-only games: compare seed by seed after every sim-touching change |
| Browser test that worked | Own tab; start screen buttons clicked by text from JS (`0` tribes, `Easy`, `Islands`, `Play`); `__openborder.send({type:"spawn", tile:41419})` + `confirmSpawn`; `sendAs` alliance requests from nations 2–7 and `send` the replies (ally all but one); an interval of `sendAs` gold donations; expand with `attack` target 0 at a **neutral tile next to your border** (aiming at your own tile does nothing); keys by `window.dispatchEvent(new KeyboardEvent("keydown", {code}))`; clicks by `pointerdown`/`pointerup` on `#map` at `screenOf(tile)`; zoom by `WheelEvent` on `#map`. Screenshots are scaled ~½ — `resize_window` 800×650 gives 1:1 pixels (reset to desktop after) |
| Console buffer | Keeps errors from earlier hot reloads (timestamps tell); for a clean check reload and collect `window` `error` events yourself |
| Hot reloads | Any edit under `src/sim` or `src/client/render` reloads the page and ends the test game |
| Shell | Long multi-line edit scripts: write them with the Write tool to the scratchpad and run `node file.cjs < /dev/null` (a bash heredoc with backticks failed). A cut-by-index script once mangled a test file when its search missed — check indexes ≥ 0 before slicing |
| Machine load | Run timing-sensitive headless batches one at a time |
| Dev server | `dev-6` (port 5178), left running |

## 6. Repository map (additions since PHASE_2_HANDOFF §6)

```
src/sim/systems/flights.ts      flights, interception, airlift / assault / strike (2B.0–2B.4)
src/sim/systems/missiles.ts     Silos, strike missile + crater, bunker buster + splash, warhead (2B.5, D-032, D-033)
src/sim/systems/suppression.ts  suppressed land (strikes, missiles)
src/sim/systems/warships.ts     Naval Base fleets, patrol, orders, guns, capture, shore distance (2B.6, D-032)
src/sim/ai/strike.ts missile.ts warship.ts   nations' air strikes, missiles, warship orders
src/client/app/flights.ts       flight HUD logic, aiming previews, the missile launcher (D-033)
src/client/render/flights.ts particles.ts    planes, missiles, blasts, scorched land; explosions
src/client/sprites.ts           the user's icon-pack art (D-028); tools/iconPack.mjs builds it
tests/sim/warships.test.ts missile.test.ts strike.test.ts …   one test file per system
docs/art/WARSHIP_ART_PROMPT.md  the image prompt for the user's warship sheet
```

## 7. Known issues / open items

| Item | Where it goes |
|---|---|
| D-033 not played by the user yet | §3.1 |
| Warship art is a stand-in (grey troop boat) | when the user's sheet arrives (§3.2) |
| Nations never fire a bunker buster (the strike missile's value wins); without Mobilize they keep big gold piles late (up to ~1M) | watch; nation build/missile tuning if the user notices |
| Nations rarely lose boats to warships (they steer around guarded waters) | accepted — warships matter most against humans and in blockades |
| Air content is rare in bot games (Air Bases ~0.1, strikes ~0.2 a game on Islands) | revisit if the user says nations never use planes |
| D-006 multiplayer model | Phase 3 start (§3.3) |
| Phase 2 leftovers (gold column, edge arrows under the leaderboard, fuller sound, real maps) | Phase 4 / parked |

## 8. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2B_HANDOFF.md` (and the sections of `PHASE_2_HANDOFF.md` it points
> to). Ask me for a short check of the D-033 changes, then start Phase 3 with decision D-006,
> following the working agreements.
