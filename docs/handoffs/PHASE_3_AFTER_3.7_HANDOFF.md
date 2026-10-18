# Phase 3 handoff after milestone 3.7 — accounts & profiles live; next: 3.8 playtest + hardening

> **For the next session: read this file first.** It replaces
> [`PHASE_3_AFTER_3.6_HANDOFF.md`](PHASE_3_AFTER_3.6_HANDOFF.md) as the entry point. Still
> valid: that file's §2 and §4 (what 3.6 added, facts),
> [`PHASE_3_AFTER_3.5_HANDOFF.md`](PHASE_3_AFTER_3.5_HANDOFF.md) §2 and §4,
> [`PHASE_3_AFTER_3.4_HANDOFF.md`](PHASE_3_AFTER_3.4_HANDOFF.md) §2 (how online play works) and
> §5–§7 (working agreements, facts, repository map),
> [`PHASE_2B_HANDOFF.md`](PHASE_2B_HANDOFF.md) §4–§6 and
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md) §4–§6. This file only adds to them.
> Written 2026-10-18. The repo docs are the source of truth: ROADMAP "Phase 3", including the
> **3.7 result** and its "Live" line; DECISIONS **D-037**; [`docs/ACCOUNTS_SETUP.md`](../ACCOUNTS_SETUP.md).

---

## 1. Where we are

| | |
|---|---|
| Phases 1, 2, 2B | ✅ tags `phase-1`, `phase-2`, `phase-2b` |
| 3.0 – 3.6 | ✅ (see the earlier handoffs) |
| **D-037** | Accepted 2026-10-18 (e7e2336). The user picked every recommendation |
| **3.7 accounts & profiles** | ✅ 1c4e5c9: **live**, accounts on the Railway volume; verified ef22767 |
| Google sign-in | **Skipped for now** (the user's choice). The code is ready and turns on when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set in Railway (setup steps in `docs/ACCOUNTS_SETUP.md` part B) |
| Next | ⬜ **3.8 multiplayer playtest + hosting hardening** (§3), which is also the Phase 3 approval |
| Tests | 573 passing (64 files); type check, Prettier and build clean; `main` = `origin/main` |

## 2. What 3.7 added (short; details in ROADMAP "3.7 result")

- **D-037 choices:**
  - Sign-in: Google, or a name + password with no email. A one-time recovery code replaces "forgot password" emails.
  - Storage: SQLite on a Railway volume.
  - Profile: name, join date, games, wins. Only online games with **≥ 2 humans** count.
  - Data: no email kept; deleting an account erases it at once. No new packages.
- **Protocol v7.** `LobbyPlayer.profile` holds the account name, or null for a guest. The game worker's `ended` message now carries `{winner, team}`.
- **Server files:**
  - `src/server/accountStore.ts`: `node:sqlite`. Tables `accounts` (name, `name_key` lowercase and unique, method, `google_sub`, `password_hash`, `recovery_hash`, `needs_name`, joined, games, wins) and `sessions` (`key_hash`, `account_id`, `expires`). Sessions last 30 days and are renewed at most once a day. `PRAGMA user_version` 1 for future changes to the tables.
  - `src/server/passwords.ts`: scrypt (N 2^15, r 8, p 3, stored as `scrypt$N$r$p$salt$hash`); SHA-256 for session keys and recovery codes; recovery codes are 4×5 letters from an alphabet without 0/O/1/I/L.
  - `src/server/accountApi.ts`: `/api/me`, `register`, `login`, `recover`, `logout`, `rename`, `delete`, `profile`, plus `/auth/google` and `/auth/google/callback`.
    - Cookie `ob_session`: HttpOnly, SameSite=Lax, Secure behind the proxy.
    - Changes are accepted only as JSON POSTs whose Origin is this site.
    - The dev page (`http://localhost:*`) gets CORS with credentials, but only when the server isn't behind the proxy.
    - Rate limits: 10 tries a minute per address, 10 per 15 minutes per name, 5 sign-ups an hour, 10 renames an hour.
    - Google: PKCE, an `ob_oauth` state cookie, scope `openid` only, and the ID token's claims are checked (issuer, audience, expiry).
  - `src/server/main.ts`:
    - Data folder: `DATA_DIR`, else `RAILWAY_VOLUME_MOUNT_PATH`, else `./data` (git-ignored).
    - `accountFor(req)` reads the cookie on the WebSocket upgrade (only from this site's pages).
    - `/health` now ends with `, accounts[ (not on a volume)], Google on|off`.
- **`src/server/lobbies.ts`:**
  - `connect(peer, address, account)` and `AccountHooks` (`reserved`, `played`, `won`).
  - A signed-in member plays under the account name; the `name` message is refused for them.
  - `takenNames` also blocks other accounts' names, so a guest gets "Name (2)".
  - `Room.counted` is set at the start (≥ 2 humans). `recordWinners` counts the FFA winner, or every member of the winning team (team taken from `config.players`).
- **Client:**
  - `src/client/app/account.svelte.ts`: `account` state, `loadAccount()` at start-up in `main.ts` (it also reads the `#signed-in` / `#signin-failed` / `#signin-cancelled` hash Google's round trip leaves), and the API calls.
  - `ui/screens/AccountDialog.svelte`: views signin / create / recover / code / profile / privacy.
  - `ui/screens/ProfileCard.svelte`: the public profile card.
  - StartScreen: account bar, "Phase 3 prototype · Privacy"; `/privacy` opens the note.
  - LobbyScreen: ✓ names open the profile card; the name field is read-only when signed in.
  - `online.ts`: `serverHttpBase()` added.
- **Tests:** `tests/server/accounts.test.ts` (17): the API over real HTTP on port 0, Google with a stand-in token endpoint, and lobbies with a real in-memory store.

## 3. Next: milestone 3.8 — multiplayer playtest + hosting hardening (= Phase 3 approval)

ROADMAP row: the user plays with friends on the cloud host (signing in too); logs; restarts
without lost lobbies where possible; a load check (many bot games on one server).

1. **Start by asking the user to playtest** (working agreement). Short guided list:
   - Make an account, save the recovery code, sign out and back in.
   - Play an online game with a friend; afterwards check games and wins on the profile.
   - Click a ✓ name in the lobby to see that profile.
   - Try the rename. Optionally use the recovery code once.
   - Also: team picking, the ping chip, Rejoin. Ask them to report anything odd.
2. **Check persistence:** after the next Railway update, the user's account must still exist (the first real proof the volume works across updates). Without creating accounts myself: `GET /api/profile?name=<their name>` before and after the update.
3. **Hardening candidates** (ask before anything game-changing):
   - Server restarts end running games. "Restarts without lost lobbies where possible" probably means saving lobbies/games to the volume, or at least telling players clearly. Present the options.
   - Structured logs.
   - A load check: many bot games on one server, measuring tick time and memory on Railway's plan.
   - A backup of `accounts.sqlite` (Railway volume backups — check what the plan includes).
4. **Firefox / Safari determinism** (open since 3.5): friends on other browsers will show it; or ask about a browser test runner.
5. **Phase 3 approval**, then tag `phase-3`.

## 4. Things to know — additions

| Fact | Detail |
|---|---|
| Live checks without accounts | Don't create accounts on the live site (it's a real service, not a local test host). Probe instead: `/api/me` → `{"account":null,"google":false}`; register with a 5-character password → 400 "Passwords need at least 8 characters."; a POST with `origin: https://evil.example` → 403; no CORS headers on `/api/me`. Volume: `/health` must not say "(not on a volume)" |
| Local servers | **8787**: an old v4 server (PID 62080, not mine to stop). **8788**: the 3.6 server (v6, PID 63544). **8789**: the 3.7 server (v7), started by me with `PORT=8789 DATA_DIR=<scratchpad>/data node src/server/main.ts`; it may be gone in a new session. Point the dev page at a server with `localStorage["openborder.devServerPort"]` |
| Dev page and cookies | Cookies ignore ports: the dev page on 5173 and a server on 8789 share `localhost` cookies (same-site), so sign-in works across ports with `credentials: "include"` and the server's dev CORS |
| Dev server | This session used **`dev`, port 5173** (other chats held 5178 and 5181) |
| Test accounts | Local only, made up in the session (generated test values; never put in chat or docs) |
| Recovery code shown once | Only its SHA-256 is stored; a lost code can't be shown again (recovering sets a new one) |
| Regression baseline | Still **8dbbacd** for `tools/hashDigest.mjs`: 3.7 didn't touch `src/sim` |
| Shell | A `.cjs` replacement with a `${...}` template inside a double-quoted JS string once didn't match for no obvious reason; the Edit tool worked. Prettier runs after scripted edits: check the result |

## 5. Open items

| Item | Where |
|---|---|
| Google sign-in (code ready, off) | When the user wants it: `docs/ACCOUNTS_SETUP.md` part B, then check `/health` "Google on" and a real sign-in |
| Account survives a Railway update | 3.8 step 2 |
| Server restarts end running games; logs; load check; database backup | 3.8 hardening |
| Firefox / Safari determinism | 3.8 playtest with friends |
| Match history, leaderboards, moderation (reports, bans) | Phase 5, built on these accounts |
| D-033 notes from the user; warship art; Phase 2B known issues | PHASE_2B_HANDOFF §3.1, §3.2, §7 |

## 6. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_3_AFTER_3.7_HANDOFF.md` (and the sections of the earlier handoffs it
> points to). Then start milestone 3.8 (multiplayer playtest + hosting hardening) by asking me to
> playtest 3.7 with friends, following the working agreements.
