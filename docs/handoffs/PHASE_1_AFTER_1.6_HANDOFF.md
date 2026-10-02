# Phase 1 handoff (after milestone 1.6)

> **For the next session: read this file first**, then
> [`PHASE_1_AFTER_1.5_HANDOFF.md`](PHASE_1_AFTER_1.5_HANDOFF.md) §3 (lessons) and
> [`PHASE_1_MIDPOINT_HANDOFF.md`](PHASE_1_MIDPOINT_HANDOFF.md) (environment gotchas, repo
> map, working agreements — all still valid). Written 2026-10-01. Last commit: `8f846eb`.

## 1. Where we are

| | |
|---|---|
| Milestones done | 1.0 scaffold · 1.1 sim core · 1.2 rendering · 1.3 combat · 1.4 encircle/eliminate/win · 1.5 AI + headless runner · **1.6 HUD & interaction** |
| Next | ⬜ **1.7 playtest & tune**, tag `phase-1`, write `PHASE_1_HANDOFF.md` |
| Tests | 139 passing, type check clean, Prettier clean, `npm run build` OK |
| Bots-only check after 1.6 | 14/14 games with a winner, median 10.4 min, tick 0.83 ms avg (unchanged by the refactor) |

## 2. What 1.6 added (details: GAME_DESIGN §5.1 "As built", ARCHITECTURE §6)

- **Command bar** (bottom): troops / capacity / field / growth per second; troop bar with a
  green sweet-spot zone (35–65%), a white ½ tick, the hatched slice a click would send,
  and a plain-words growth status; pulses amber when full.
- **Odds** from `src/sim/battle.ts` (moved out of `ai/bot.ts`; the bots use the very same
  functions, results unchanged): Overwhelming · Advantage · Even · Costly · Hopeless, and
  for incoming attacks a threat level.
- **Attack chips** with army bar, odds, × retreat; incoming chips with **Counter N**.
- **Hover card** with battle preview; **right-click menu** (presets with odds, retreat).
- **Leaderboard + clock + menu button** (top right), **toasts** (top center),
  **pause menu** (Esc: resume, speed 1×/2×/4×, controls, leave match),
  **hints** (bottom left; finished hints stored in localStorage `borderline.hints.v1` —
  clear it to see them again).
- Tick frames now include `PlayerSnapshot.neighbors` (humans only) — what a click can reach.

## 3. Lessons from this session

- **A second dev server**: when another chat's server holds port 5173, start
  `.claude/launch.json` → **`dev-alt`** (port 5174) with `preview_start`.
- **The user plays in whatever tab is visible — including my test tab.** Unexplained
  expansions/attacks in my tab turned out to be real clicks (I logged pointer events on
  `#map` to prove it). Before suspecting a bug, log `pointerdown/pointerup` on `#map`
  and `keydown` on `window`. The browser tool's `key` and `hover` actions don't click.
- Scripted checks that worked well: `__borderline.send({type:"spawn", tile})`, then
  `confirmSpawn`, `setSpeed(8)`, poll `frame()` until a condition, `pause()`. Find a tile of
  player N with `renderer().map.ownerCapture` (owner at even indices).
  `__borderline.setSpeed` now also updates the HUD's speed badge.

## 4. Next steps — milestone 1.7 (playtest & tune)

**Done when (ROADMAP):** matches ≈ 8–12 min, budgets met, stable commit tagged `phase-1`.

1. Ask the user to play a few full games with the new HUD and collect their impressions
   (is the sweet spot clear? do odds labels match what happens? is anything confusing?).
2. Work through ROADMAP "Notes collected for 1.7": growth floor for big empires, land-race
   length (~60–90 s), encirclement/GC tick spikes, aggressor win rate, the 50-min outlier,
   odds thresholds, counter sizing.
3. Re-run `npm run headless -- --games 100` after each balance change; record results in
   ROADMAP.
4. Performance pass (perf overlay F3; tick p99, frame CPU).
5. Tag `phase-1`, write `docs/handoffs/PHASE_1_HANDOFF.md` (full Phase 1 summary), and tell
   the user to start Phase 2 in a new chat.

## 5. Suggested opening prompt

> Read `docs/handoffs/PHASE_1_AFTER_1.6_HANDOFF.md`, then the handoffs and docs it points
> to, and continue with Phase 1 at milestone 1.7 (playtest & tune). Follow the working
> agreements in the handoffs.
