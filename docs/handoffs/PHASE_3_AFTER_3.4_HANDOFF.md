# Phase 3 handoff after milestone 3.4 — online play is live; next: 3.5 resync & reconnect

> **For the next session: read this file first.** It replaces
> [`PHASE_3_AFTER_3.0_HANDOFF.md`](PHASE_3_AFTER_3.0_HANDOFF.md) as the entry point. The
> working agreements, environment facts and repository maps of
> [`PHASE_2B_HANDOFF.md`](PHASE_2B_HANDOFF.md) §4–§6 and [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md)
> §4–§6 still apply — read those too; this file only adds to them. Written 2026-10-17. The
> repo docs (ROADMAP "Phase 3", DECISIONS D-006, D-034 – D-036) are the source of truth.

---

## 1. Where we are

| | |
|---|---|
| Phases 1, 2, 2B | ✅ tags `phase-1`, `phase-2`, `phase-2b` |
| D-033 (Phase 2B playtest fixes) | built and verified by me; the user never sent notes on it — ask once, lightly (PHASE_2B_HANDOFF §3.1) |
| **Phase 3 decisions** | D-006 **hybrid** (option C) · D-034 **Railway**, US East, `ws` package · D-035 lobby links **and** public lobbies, just a name (amended: accounts in 3.7) · D-036 bots fill |
| 3.0 snapshots + determinism harness | ✅ b528d1f |
| 3.1 server + first deploy | ✅ c2d1e85, 45462a5 — **live at https://openborders-production.up.railway.app** |
| 3.2 lobby names + Ready | ✅ fe33387 |
| 3.3 validation, budgets, limits | ✅ 305bf36, 1ec075d, 74b1343 (verified live) |
| 3.4 public lobbies + countdown + name blocklist | ✅ d42071e; **60 s online spawn timer** e4cb1ae (found live); e9108db |
| Next | ⬜ **3.5 hash checks → resync, reconnect, late join / spectators** (§3) · 3.6 online feel · **3.7 accounts & profiles** (the user's request, §4) · 3.8 multiplayer playtest = Phase 3 approval |
| Tests | 528 passing (59 files), type check, Prettier and build clean; `main` = `origin/main` |

The user has played online already: they joined my public test game on the live site from
their own start screen. That's how the spawn-phase bug surfaced; it's fixed now.

## 2. How online play works now (short)

- **One Node process** (`npm start` → `src/server/main.ts`) serves `dist/` and the WebSocket
  `/ws`; every running game has its own worker thread (`gameWorker.ts` → `ServerGame` in
  `game.ts`) ticking every 100 ms on a drift-free schedule. `GET /health` → `ok N games, M
  connections, behind proxy`; `GET /api/games` → open public games; `GET /debug/address` →
  the caller's own address headers.
- **Protocol** (`src/shared/protocol.ts`, **v4**; an older page is told to reload): `hello` →
  `create {settings, name}` / `join {gameId, name}` → `name`, `ready`, `visibility` (creator),
  `start` (creator) → `command`. Server → `lobby {players, you, creator, summary, public,
  startsIn}`, `start {config, playerId}`, `turn {tick, commands, hash}`, `error`.
- **Same game everywhere:** `GameConfig` = map spec + seed + players; both sides build the world
  with **`ONLINE_RULES`** (defaults + `spawn.timeoutTicks: 600`). The server stamps every
  command with the connection's player and shape-checks it (`validate.ts`: exact field schemas,
  a compile error if a command type lacks one); the sim judges meaning.
- **Browser:** `client/app/online.ts` `OnlineSession` (socket, lobby state in `ui.online`,
  name in `localStorage` `openborder.name`); `host/networkHost.ts` runs the worker sim from the
  server's turns (`LocalHost.applyTurn`, `WorkerHost` `turns` mode) and compares each tick's
  hash with the server's — a mismatch sets `ui.online.outOfSync` and logs a warning (**no
  repair yet — that is 3.5**). In development the page (Vite, e.g. port 5179) talks to the
  game server on **port 8787** (`npm start` must be running).
- **Lobbies** (`lobbies.ts`, socket-free, fully tested with fake peers and a fake clock):
  private by default (unguessable 12-character id = the link); public games listed; a public
  game with 2+ players starts by itself after 30 s; the creator may always start ("Start anyway
  — N not ready"); leaving a lobby passes the creator role on; a running game stops when every
  human has left; a player who leaves mid-game keeps their land and stops acting.
- **Limits:** per connection 30 messages at once / 15 a second (60 drops → closed), 20
  malformed commands → closed, 40 raw messages a second, 8 KB per message; 8 connections per
  address and 2,000 in all (429), 3 open games per address, 20 games per server, 16 humans per
  game. Behind Railway the address is **`X-Real-IP`** (Railway overwrites it — checked).
- **Names:** `cleanName` (≤ 16, letters of any alphabet, digits, spaces, `._'!?&()-`),
  `uniqueName` ("Sam (2)", also against bot names), `nameFilter.ts` blocklist with lookalikes.

## 3. Next: milestone 3.5 — hash checks, resync, reconnect, spectators

Start by asking for a short check of 3.2–3.4 if the user hasn't played online since (lobby
names, Ready, public list, countdown, the spawn timer). Then build, bots-first and tested
headless before UI (my proposed order — decide details yourself, they're not game-changing):

1. **Hash reports + resync.** Clients already compare every tick; add: a drifting client tells
   the server (`{t:"desync", tick}`), the server answers with a **snapshot** (`serializeWorld`
   from its worker — the worker must be able to serialize on request) plus the turns since; the
   client rebuilds its worker world (`deserializeWorld` on its own map with `ONLINE_RULES`) and
   resets renderer/HUD state (frames after the restore describe a different world). Test by
   corrupting a client world on purpose. Compress snapshots on the wire only if size hurts
   (~150–450 KB JSON on a Normal map).
2. **Reconnect.** `start` gives each player a secret **rejoin token** (random, per game); a
   dropped player who reopens the page (token in `sessionStorage` or the link) gets snapshot +
   turns and their own country back. Decide how long a game keeps a seat (the game runs on).
3. **Late join / spectate.** Anyone with a running game's link may watch: snapshot + live turns,
   no commands accepted (`playerId` 0). Public running games could be listed as "watch".
4. **Auto-reconnect** in the client after a dropped socket (a few retries) — the "Lost the
   connection" message today is final.
5. Railway deploys a new version by **restarting the server — every running game ends**. Note it
   for the user; resuming games across restarts is out of scope (3.8 "hardening" may revisit).

Done when: a client with a corrupted world repairs itself within a second or two; closing and
reopening a tab mid-game puts the player back in their country; a spectator can watch; all
verified headless (extend `tools/onlineSmoke.ts`), in two tabs locally and live on Railway.

## 4. The user's request: profiles and accounts → milestone 3.7

Asked 2026-10-17: "build profiles with possible google sign in or create and accounts …
doesn't have to be right now". Placed as **3.7 Accounts & profiles** (ROADMAP Phase 3 table,
DECISIONS D-035 amendment), before the final playtest (now 3.8). Optional sign-in (Google
and/or email + password), guests keep playing with a name; profile = display name, games, wins,
join date; signed-in names reserved. Needs a **database** (Railway Postgres — a cost: ask), a
**Google Cloud OAuth client** (the user creates it), secure session cookies, a vetted
password-hashing package (ask before installing), a short privacy note. At its start, present
**D-037** as WHAT / WHY / OPTIONS / RECOMMENDATION and ask the concrete questions (which sign-in
methods, what a profile shows publicly, what data is kept, how to delete an account). Match
history and leaderboards stay in Phase 5, built on these accounts.

## 5. Working agreements — additions

- Unchanged: lead, plain words, ask only on game-changing decisions (with WHAT / WHY / OPTIONS /
  RECOMMENDATION), place every request in the right milestone and say where and why, no fake
  systems, verify in my own browser tab, push + confirm after every handoff.
- **Railway cannot auto-deploy** (the user said so). After every push that changes the server or
  the page: ask the user to **update the app on Railway**, then verify it's live — the page's
  bundle name (`index-*.js`) equals `dist/assets` after a local build; for server-only changes
  probe behaviour (e.g. `/health` wording, `tools/onlineAbuse.ts`). Docs/tools-only pushes need
  no update.
- **An update restarts the server and ends running online games** — check `/health` for games
  in progress (the user may be playing) and ask before.
- The user answers short; "do X then handoff" = finish X, place requests, write the handoff.
- They play at Medium; they'll test online with friends in North America.

## 6. Things to know — additions

| Fact | Detail |
|---|---|
| Live site | https://openborders-production.up.railway.app — Railway Hobby, US East, one replica, `railway.json` (build `npm run build`, start `npm start`, health `/health`) |
| Local online testing | `npm run build` then `npm start` (port 8787) in the background; the Vite page connects to it. My background server tasks report "failed, exit 127" when I stop them — that's just the kill; check port 8787 with PowerShell `Get-NetTCPConnection -LocalPort 8787` |
| Tools | `node tools/onlineSmoke.ts [ws-url] [ticks]` — two scripted players (create, join, Ready, start, play) checking every hash; `node tools/onlineAbuse.ts [ws-url]` — flood, junk, connection swarm, 20 KB message; `node tools/crossEngine.ts` — Node vs browser determinism |
| Production page | no `__openborder` debug hook: drive it with DOM clicks (`.open-games button`, `#lobby-name` + `input` / `blur` events, `.switch input` + `change`) and `PointerEvent`s on `#map` |
| Background tabs | `focus()`/`blur()` don't fire in the hidden pane — dispatch `new FocusEvent("blur")`; `javascript_tool` times out at 45 s — split long waits |
| Shell | `node -e` replacements fail when the text has backticks, `\n` escapes or `${}`; write a `.cjs` file with a quoted heredoc, or use the Edit tool; Prettier reflows code, so scripted exact-string edits after a format may miss |
| Spawn rule | `rules.spawn.timeoutTicks` (0 = wait for every human — solo); `ONLINE_RULES` 600 |
| Regression baseline | still **4d597f7** for `tools/hashDigest.mjs` (bots-only games unchanged through 3.4); worktree needs `git -c core.longpaths=true worktree add` |

## 7. Repository map — additions

```
src/shared/protocol.ts        online messages, settings check, names, ONLINE_RULES, open-game types
src/shared/nameFilter.ts      the name blocklist (D-035)
src/server/main.ts            http (dist/, /health, /api/games, /debug/address) + /ws, limits
src/server/lobbies.ts         lobbies, public list, countdown, start, leaving (socket-free)
src/server/game.ts            ServerGame: queue → stamp → tick → turn + hash
src/server/gameWorker.ts      one game per worker thread, 100 ms schedule
src/server/validate.ts        command schemas, CommandBudget
src/host/networkHost.ts       the browser's sim on the server's turns, hash check
src/client/app/online.ts      OnlineSession, fetchOpenGames, saved name, links
src/client/ui/screens/LobbyScreen.svelte   name, link, settings, public switch, countdown, Ready, Start
tests/server/                 lobbies, validate (+ fuzz), publicLobbies
tests/sim/snapshot.test.ts, spawnTimeout.test.ts
tools/onlineSmoke.ts onlineAbuse.ts crossEngine.ts determinismGames.ts
railway.json
```

## 8. Open items

| Item | Where |
|---|---|
| Drift repair, reconnect, spectators, auto-reconnect | 3.5 (§3) |
| Pending click feedback, teams online, end-of-game from the server, latency indicator | 3.6 |
| Accounts & profiles (the user's request) | 3.7 (§4) |
| Server restarts end running games; logs; load check | 3.8 hardening |
| Firefox / Safari determinism (needs a browser test runner — ask) | 3.x or the 3.8 playtest with friends |
| D-033 notes from the user; warship art; Phase 2B known issues | PHASE_2B_HANDOFF §3.1, §3.2, §7 |

## 9. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_3_AFTER_3.4_HANDOFF.md` (and the sections of `PHASE_2B_HANDOFF.md`
> and `PHASE_2_HANDOFF.md` it points to). Ask me for a quick check of the online lobbies if I
> haven't played since, then start milestone 3.5, following the working agreements.
