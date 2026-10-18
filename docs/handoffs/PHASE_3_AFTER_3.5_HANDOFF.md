# Phase 3 handoff after milestone 3.5 — repair, rejoin, spectators live; next: 3.6 online feel

> **For the next session: read this file first.** It replaces
> [`PHASE_3_AFTER_3.4_HANDOFF.md`](PHASE_3_AFTER_3.4_HANDOFF.md) as the entry point; that file's
> §2 (how online play works), §4 (accounts → 3.7), §5–§7 (working agreements, facts, repository
> map) still apply, as do [`PHASE_2B_HANDOFF.md`](PHASE_2B_HANDOFF.md) §4–§6 and
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md) §4–§6. This file only adds to them. Written
> 2026-10-17. The repo docs (ROADMAP "Phase 3" incl. the **3.5 result**, DECISIONS) are the
> source of truth.

---

## 1. Where we are

| | |
|---|---|
| Phases 1, 2, 2B | ✅ tags `phase-1`, `phase-2`, `phase-2b` |
| D-033 amendment (the user, after playing 3.4) | ✅ 8dbbacd — missile blasts grow with the Silo level: crater 7 / 10 / 13 km, buildings 10 / 13 / 16 km, buster splash 5 / 6 / 8 km (`rules.ts` silo `blast`, `missileBlast`, `Flight.sourceLevel`); live |
| 3.0 – 3.4 | ✅ (see the 3.4 handoff) — the user played online since 3.4: "it was fine" |
| **3.5 repair, rejoin, auto-reconnect, spectators** | ✅ 4f8608a — **live and verified** on Railway (smoke + browser) |
| Next | ⬜ **3.6 online feel** (§3) · 3.7 accounts & profiles · 3.8 playtest with friends = Phase 3 approval |
| Tests | 545 passing (61 files); type check, Prettier, build clean; `main` = `origin/main` |

## 2. What 3.5 added (short — details in ROADMAP "3.5 result")

- **Protocol v5.** Client → `desync {tick}`, `rejoin {gameId, token}`; `join` on a running game =
  watch. Server → `start {gameId, config, playerId, rejoin, midGame}`, `sync {snapshot}`,
  `presence {playerId, connected}`.
- **Repair:** `NetworkHost` checks every turn's hash and that turns follow each other; on a
  difference it asks once (again every 8 s), drops turns until the `sync`, then
  `restore(snapshot)` in the worker (`simWorker` `restore` → `restored`, `FrameSlimmer` /
  `FrameRestorer` reset). The client's `restored()` redraws only the tiles that differ, resets
  fort levels, effects, alerts. The server's worker makes snapshots between ticks
  (`ServerGame.snapshot()`, cached per tick); `Lobbies` sends it as the worker's JSON text
  (`Peer.sendText`) to everyone waiting; one per connection per 5 s.
- **Rejoin:** tokens per seat (`Member.token`); the page keeps the seat in sessionStorage *and*
  localStorage (`openborder.rejoin`) and puts `?game=<id>` in the address bar, so reloads and
  reopened links rejoin; a rejoin from another tab takes the seat ("This game was opened in
  another tab."). Others get "X lost the connection — their country waits" / "X is back".
- **Empty games:** with no human connected a running game runs **2 minutes** more
  (`EMPTY_GAME_GRACE_MS`), then stops. Such games still count toward the 3-games-per-address
  limit meanwhile (`tools/onlineAbuse.ts` from an address with lingering games shows the junk
  sender "still open" — it never got into a game; on a fresh server all four checks pass).
- **Auto-reconnect:** 1, 2, 4, 8, 15 s, then "Lost the connection". Close code 1008 (kicks,
  "replaced") never retries.
- **Spectators:** player 0, ≤ 32 per game; `me` is −1 in the client's frame handling (0 is
  neutral land); clicks/keys ignored except Esc, the perf overlay and the air-defence view;
  running public games stay listed with **Watch** ("Public games").
- **Banner** over the toasts (`onlineBanner` in `online.ts`): catching up / reconnecting /
  watching / errors.
- **Compression:** `perMessageDeflate` for messages ≥ 16 KB — negotiated through Railway's proxy.
- **Dev tools:** `__openborder.corrupt()` (changes this browser's world only — hash check fails,
  repair follows; it changes counts, not drawn tiles), `__openborder.dropConnection()`;
  `localStorage["openborder.devServerPort"]` points the dev page at another local server.
  `node tools/onlineSmoke.ts [url] [ticks]` now also corrupts the creator, adds a spectator and
  drops + rejoins the joiner; prints OK/FAILED.

## 3. Next: milestone 3.6 — online feel

Start by asking the user for a short check of 3.5 with a friend or two tabs (reload mid-game,
open the link in another browser to watch, a public game's **Watch** button). Then, from the
ROADMAP row (decide details yourself; ask only on game-changing ones):

1. **Pending click feedback:** an order shows at once (a ghost arrow / "sending…" chip) until
   the turn carrying it arrives (~100–200 ms online; rejected → the existing console/toast).
2. **Teams online:** the lobby's settings already carry teams (`gamePlayers` deals humans
   round-robin) — check team games end to end online (win at 85%, team colours, teammates'
   pings), and whether players should pick a team in the lobby (ask: game-changing?).
3. **End of game from the server's result:** the end card already comes from the sim (same on
   every client); make sure a watcher and a rejoined player see it, and that the seat is
   forgotten when the game ends (today the next reload just gets "That game has ended.").
4. **Latency indicator:** ping/turn delay in the HUD (the server could echo a timestamp; turns
   arrive every 100 ms, so "late turns" are measurable client-side).
5. Optional (mine to decide): a start-screen "Rejoin your game" button when a seat is saved but
   the address bar has no link.

Done when it feels like the solo game online; verified headless, in two tabs and live.

## 4. Things to know — additions

| Fact | Detail |
|---|---|
| Old local server | A **v4** game server from an earlier session still listens on **port 8787** (PID 62080 at the time). I was not allowed to stop it. The dev page talks to 8787 → "This page is out of date". Ask the user to stop it (Task Manager → node.exe, or `Stop-Process -Id <pid>` themselves), or set `openborder.devServerPort` and run `PORT=8788 node src/server/main.ts` in the background (what 3.5 did) |
| Same-browser tabs | Tabs share localStorage: a fresh tab opening a game link uses the browser's saved seat (takes it over). For spectator tests in the same browser remove `openborder.rejoin` from localStorage first |
| Slow tests | Tests that generate Normal maps (`tests/server/rejoin.test.ts` snapshot test, `tests/host/networkHost.test.ts`) have 30 s timeouts — the default 5 s failed under full-suite load |
| Railway | Updates are manual (the user does them); verify the bundle name equals `dist/assets/index-*.js`, then `node tools/onlineSmoke.ts wss://openborders-production.up.railway.app/ws 400`. An update still ends running games (3.8) |
| Regression baseline | Missile change 8dbbacd changed bots-only games that fire missiles (flights-off games identical). New baseline for `tools/hashDigest.mjs`: **8dbbacd** (3.5 didn't touch the sim) |
| Dev server | `dev-6` came up on port **5180** this session |

## 5. Open items

| Item | Where |
|---|---|
| Pending click feedback, teams online, end-of-game handling, latency indicator | 3.6 (§3) |
| Accounts & profiles (the user's request) | 3.7 (3.4 handoff §4) |
| Server restarts end running games; logs; load check | 3.8 hardening |
| Firefox / Safari determinism | 3.8 playtest with friends (or a browser test runner — ask) |
| D-033 notes from the user; warship art; Phase 2B known issues | PHASE_2B_HANDOFF §3.1, §3.2, §7 |

## 6. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_3_AFTER_3.5_HANDOFF.md` (and the sections of the earlier handoffs it
> points to). Ask me for a quick check of 3.5 (rejoin, watching) if I haven't played since, then
> start milestone 3.6, following the working agreements.
