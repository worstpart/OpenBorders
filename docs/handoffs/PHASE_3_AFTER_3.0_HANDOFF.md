# Phase 3 handoff after milestone 3.0 — next: 3.1 server skeleton + first deploy

> **Superseded as the entry point by [`PHASE_3_AFTER_3.4_HANDOFF.md`](PHASE_3_AFTER_3.4_HANDOFF.md)**
> (2026-10-17).

> **For the next session: read this file first.** It replaces
> [`PHASE_2B_HANDOFF.md`](PHASE_2B_HANDOFF.md) as the entry point, but **§4 (how the user
> wants us to work), §5 (things to know) and §6 (repository map) of PHASE_2B_HANDOFF, and §4–§6
> of [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md), still apply** — read those too. Written
> 2026-10-16, mid-phase (the session got long). The repo docs are the source of truth.

---

## 1. Where we are

| | |
|---|---|
| Phases 1, 2, 2B | ✅ tags `phase-1`, `phase-2`, `phase-2b` |
| D-033 (Phase 2B playtest fixes, 4d597f7) | built and verified by me; **the user's short check is still pending** (they said they'd send notes after playing — PHASE_2B_HANDOFF §3.1 has the list) |
| **Phase 3 decisions** (e5db369) | **D-006 accepted: option C hybrid** (server runs the same sim, validates/relays commands, compares hashes, repairs with snapshots). **D-034** a cloud host from the start (the user's choice over my "own computer first"). **D-035** lobby links **and** public lobbies; just a name, no accounts. **D-036** nations and tribes fill empty slots. Milestones 3.0–3.7 in ROADMAP "Phase 3" |
| **3.0 snapshots + determinism harness** (b528d1f) | ✅ — ROADMAP "3.0 result" has every number |
| Tests | 501 passing (55 files), type check, Prettier and build clean |

## 2. What 3.0 delivered (in short)

- `src/sim/snapshot.ts` — `serializeWorld(world)` → JSON-safe `WorldSnapshot`;
  `deserializeWorld(snapshot, map, rules)` rebuilds it on the receiver's own map (regenerated
  from the seed) and throws on another map / other rules / a hash mismatch / a newer version.
  Generic: saves every World field except `SKIPPED_WORLD_FIELDS` (map, rules, per-tick output,
  scratch); a new class inside the World makes it throw ("teach snapshot.ts about it"). ~150–450
  KB JSON for Islands 1100×700, ~15 ms to save, ~10 ms to rebuild — no compression yet.
- `TileQueue.save()` / `TileQueue.restore()` (the only edit to an existing sim file).
- `src/sim/replay.ts` — `CommandRecorder` (seed, players, non-empty turns, checkpoint hashes)
  and `replayLog(log, map, rules, {from?, until?})` → `{world, divergedAt}`.
- `tests/sim/snapshot.test.ts` — generated Islands game + a staged war with every 2B system;
  all copies go through JSON text and a fresh map; full-state comparison, not just hashes.
- `tools/determinismGames.ts` (pure; imported by Node and by a browser tab through the dev
  server: `await import("/tools/determinismGames.ts")`) + `node tools/crossEngine.ts [ticks]
  [seeds] [configs]`. Node 24 = Chromium 152 on 6 × 3,000 and 1 × 12,000 ticks.
- Bots-only games identical to `4d597f7` (`tools/hashDigest.mjs`; still the baseline).

## 3. Next session

### 3.1 First: the user's D-033 notes
If they haven't sent them, ask once (the list is in PHASE_2B_HANDOFF §3.1). Tuning → fix now;
new systems → roadmap.

### 3.2 Then milestone 3.1 — server skeleton + first deploy (ROADMAP table)
Before any code, two things the user decides:

1. **Hosting provider (D-034).** Present WHAT / WHY / OPTIONS / RECOMMENDATION in plain words,
   with **current** prices and limits (look them up — don't quote from memory). Needs: an
   always-on Node process, WebSockets, deploy from GitHub `worstpart/OpenBorders`; serverless
   platforms that sleep or stop between requests don't fit (a free tier that sleeps is OK only
   for early testing — say so). Typical candidates: a managed app platform (e.g. Render, Railway,
   Fly.io) vs a small VPS (e.g. Hetzner, DigitalOcean). The user creates the account and enters
   payment details **themself** — never do it for them.
2. **The `ws` package** for the server's WebSocket (the browser side uses the built-in
   WebSocket — `host` may not import packages). Say what and why, then ask before installing.

Shape agreed in D-034: **one Node service** serving the built client (`dist/`) and the game
WebSocket on the same address; one game per worker thread running `runTick` on a 100 ms turn
scheduler; `src/server/` (import rules already in `tests/guards/importBoundaries.ts`) and a
`NetworkHost` implementing `SimHost` (`src/host/host.ts`) next to `LocalHost` / `WorkerHost`.
Turns carry `StampedCommand`s; the server stamps `playerId` from the connection. Clients get
the game config (map spec + seed + players + rules) and, when joining late, a snapshot.
Done when: two tabs on this computer play one game, then the same build runs on the cloud host
and two browsers anywhere play it. Until 3.3 only unguessable game links, plus connection and
message-size limits.

Design notes from 3.0 to keep in mind:
- A client builds its frames from its own restored world, so its first frame is complete; on a
  **resync** (3.5) its renderer/HUD state must be reset too.
- Snapshots are plain JSON; compress for the wire later (3.5) if size matters.
- Pause and speed stay solo-only (`SimHost` already marks them local-only).

## 4. Working agreements — additions

- Unchanged from PHASE_2B_HANDOFF §4 (lead, plain words, ask only on game-changing decisions,
  verify in my own browser tab, warn before edits under `src/sim` or `src/client/render`
  that reload the user's game, push + confirm after every handoff).
- The user's latest instruction style: "continue … context window is low" = write a handoff and
  continue in a fresh chat.

## 5. Things to know — additions

| Fact | Detail |
|---|---|
| Dev server this session | `dev-6` came up on **port 5179** (5178 was taken); left running |
| Baseline worktree | in the scratchpad it needs `git -c core.longpaths=true worktree add --detach <dir> 4d597f7` (icon-pack paths are too long otherwise); remove it afterwards |
| Prettier vs scripted edits | scripted exact-string replacements after Prettier ran fail — use the Edit tool, or check that each search string is present before writing |
| `erasableSyntaxOnly` | no TypeScript parameter properties (`constructor(private x)`), enums or namespaces — Node runs `.ts` files directly |

## 6. Repository map — additions

```
src/sim/snapshot.ts            serializeWorld / deserializeWorld, map & rules fingerprints (3.0)
src/sim/replay.ts              CommandRecorder, replayLog (3.0)
tests/sim/snapshot.test.ts     round trips, staged war, encoding, refusals (3.0)
tools/determinismGames.ts      cross-engine games (pure; Node + browser)
tools/crossEngine.ts           Node runner for them
docs/handoffs/PHASE_3_AFTER_3.0_HANDOFF.md   this file
```

## 7. Open items

| Item | Where |
|---|---|
| The user's D-033 notes | §3.1 |
| Hosting provider + `ws` package | start of 3.1 (§3.2) |
| Firefox / Safari determinism (needs a browser test runner package — ask) | 3.x when the user agrees; friends' browsers in 3.7 regardless |
| Warship art | PHASE_2B_HANDOFF §3.2, whenever the sheet arrives |
| Phase 2B known issues (nations never fire busters, rare air content, gold piles) | PHASE_2B_HANDOFF §7 |

## 8. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_3_AFTER_3.0_HANDOFF.md` (and the sections of `PHASE_2B_HANDOFF.md`
> and `PHASE_2_HANDOFF.md` it points to). Ask me for my D-033 notes if I haven't sent them, then
> start milestone 3.1 with the hosting choice, following the working agreements.
