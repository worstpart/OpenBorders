# Phase 3 handoff after milestone 3.6 — online feel live; next: 3.7 accounts & profiles

> **For the next session: read this file first.** It replaces
> [`PHASE_3_AFTER_3.5_HANDOFF.md`](PHASE_3_AFTER_3.5_HANDOFF.md) as the entry point; that file's
> §2 and §4 (what 3.5 added, facts), [`PHASE_3_AFTER_3.4_HANDOFF.md`](PHASE_3_AFTER_3.4_HANDOFF.md)
> §2 (how online play works), §4 (accounts → 3.7), §5–§7 (working agreements, facts, repository
> map), [`PHASE_2B_HANDOFF.md`](PHASE_2B_HANDOFF.md) §4–§6 and
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md) §4–§6 still apply. This file only adds to them.
> Written 2026-10-18. The repo docs (ROADMAP "Phase 3" incl. the **3.6 result**, DECISIONS
> D-035 amendments) are the source of truth.

---

## 1. Where we are

| | |
|---|---|
| Phases 1, 2, 2B | ✅ tags `phase-1`, `phase-2`, `phase-2b` |
| 3.0 – 3.5 | ✅ (see the earlier handoffs); the user played 3.5 online: "it was fine" |
| **3.6 online feel** | ✅ ef05796 — **live and verified** on Railway (smoke, end check, browser) |
| Team choice (the user) | **Pick your team in the lobby** — D-035 amendment 2026-10-17 |
| Next | ⬜ **3.7 accounts & profiles** (§3) · 3.8 playtest with friends + hosting hardening = Phase 3 approval |
| Tests | 556 passing (63 files); type check, Prettier, build clean; `main` = `origin/main` |

## 2. What 3.6 added (short — details in ROADMAP "3.6 result")

- **Protocol v6.** Client → `team {team}`, `ping {at}`; server → `pong {at}`; `LobbyPlayer.team`.
- **Orders on their way:** `NetworkHost.pendingOrders` (sent, not yet back in a turn; matched by
  the command's JSON, the local player's only; dropped after `PENDING_ORDER_MS` 4 s; a snapshot
  clears them) and `orderDelayMs` (median of the last 9). `client/app/pendingOrders.ts`
  (`orderTile`, `pendingRings`, `slowOrder`, `latencyTone`); the map draws a spinning dashed ring
  (`markers.ts` `orders`); `ui.sendingOrder` after 250 ms, `ui.orderDelayMs`.
- **Latency:** ping every 2 s, smoothed into `ui.online.pingMs`; `hud/NetStat.svelte` in the
  top-right status chip (green < 150, yellow < 300, red); tooltip adds the order delay. No turn for
  `STALL_MS` 1.5 s while playing → `ui.online.stalled` → banner "Waiting for the server…".
  Live from here: ~70 ms round trip, ~95 ms per order.
- **Teams:** newcomers to the smallest team (`smallestTeam`), **Join** switches; nations dealt by
  `nationTeams` (smallest team, ties → fewer humans, then lowest) — used by the server's
  `gamePlayers` *and* the lobby's preview, so they always agree. Solo games unchanged.
- **End of game:** `OnlineSession.finished()` on the `ended` phase — forgets the seat, clears the
  address bar, stops reconnecting. Watchers get their own end card (`EndCard.svelte`, "Game over —
  X won", winner's / winning team's land, Back to start). The server keeps a finished room
  `FINISHED_GAME_KEEP_MS` (2 min; the worker keeps the final world for snapshots); finished rooms
  aren't listed, watchable, played or counted (`gameCount`, `/health`, per-address limit).
- **Start screen:** "Rejoin your online game" when `anySavedSeat()` finds a seat.
- **Dev:** `__openborder.lag(ms)` delays every outgoing message (to see the ring and "sending…"
  locally). `tools/onlineSmoke.ts` now plays a 2-team game (joiner switches team, ping checked);
  new `tools/onlineEnd.ts [url]` — a team game with no nations is won at the start; checks the
  rejoin gets the finished world and a spectator is refused.

## 3. Next: milestone 3.7 — accounts & profiles

Start as the 3.4 handoff §4 says: present **D-037** as WHAT / WHY / OPTIONS / RECOMMENDATION
and ask the concrete questions (sign-in methods: Google and/or email + password; what a profile
shows publicly; what data is kept; how an account is deleted). Things to ask before building:
the **Railway Postgres** add-on (a small monthly cost), the **Google Cloud OAuth client** (the
user creates it; I write step-by-step instructions), a vetted **password-hashing package** and
any cookie/session package (say which and why before installing). Guests keep playing with just
a name; signed-in names are reserved; a short privacy note. Match history and leaderboards stay
in Phase 5. A quick check of 3.6 first is optional (the user may play with friends meanwhile:
team picking, the ping figure, rejoin button).

## 4. Things to know — additions

| Fact | Detail |
|---|---|
| Old local server | The **v4** server from an earlier session still listens on **8787** (PID 62080). 3.6 ran its server on **8788** (`PORT=8788 node src/server/main.ts` in the background) with `localStorage["openborder.devServerPort"] = "8788"` in my dev tab — a dev page without that setting talks to the old server and says "out of date". Ask the user to stop PID 62080 if it matters |
| Dev server | `dev-6` came up on port **5181** this session |
| Reading UI state in dev | `await import("/src/client/app/uiState.svelte.ts")` returns the page's own `ui` (e.g. `ui.orderDelayMs`, `ui.online.pingMs`) |
| Live tooltip timing | The order delay appears in the tooltip only after an order came back — read it a few seconds after clicking |
| Tool on a shared server | `onlineEnd.ts` compares `/health`'s count with the one before it started (other games may be running, e.g. a smoke game in its 2-minute empty grace) |
| Regression baseline | Still **8dbbacd** for `tools/hashDigest.mjs` — 3.6 didn't touch `src/sim` |
| Shell | Scripted edits with regex text: a heredoc'd `.cjs` dropped a `\d` backslash in a template literal — check regexes after such edits, or use the Edit tool |

## 5. Open items

| Item | Where |
|---|---|
| Accounts & profiles (the user's request) | 3.7 (§3) |
| Server restarts end running games; logs; load check | 3.8 hardening |
| Firefox / Safari determinism | 3.8 playtest with friends (or a browser test runner — ask) |
| D-033 notes from the user; warship art; Phase 2B known issues | PHASE_2B_HANDOFF §3.1, §3.2, §7 |

## 6. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_3_AFTER_3.6_HANDOFF.md` (and the sections of the earlier handoffs it
> points to). Then start milestone 3.7 (accounts & profiles) by presenting D-037 and asking me
> the questions, following the working agreements.
