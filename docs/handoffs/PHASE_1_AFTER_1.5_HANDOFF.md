# Phase 1 handoff (after milestone 1.5 + spread/visual changes)

> **For the next session: read this file first**, then
> [`PHASE_1_MIDPOINT_HANDOFF.md`](PHASE_1_MIDPOINT_HANDOFF.md) (environment gotchas, repo
> map, working agreements — all still valid) and the docs they list. Written 2026-10-01.

## 1. Where we are

| | |
|---|---|
| Milestones done | 1.0 scaffold · 1.1 sim core · 1.2 rendering · 1.3 combat · 1.4 encircle/eliminate/win · **1.5 AI opponents + headless runner** |
| Next | ⬜ **1.6 HUD & interaction**, then ⬜ 1.7 playtest & tune, then write `PHASE_1_HANDOFF.md` |
| Tests | 120 passing, type check clean |
| Last milestone result | 100 bots-only games: 100/100 with a winner, median 12.7 min (see ROADMAP "Milestone 1.5 result") |

## 2. Done after milestone 1.5 (user requests, this session's last commit)

1. **Crushing attacks flood faster**: `combat.delayRatioMin` 0.8 → 0.25 — an army with 4× the
   defender's home troops advances ~4× as fast as an even fight (test added).
2. **Red front glow**: land under attack by another player glows pulsing red on the
   defender's side (stronger when the local player is involved); neutral expansion keeps
   a soft glow in the owner's color (`map.frag`).
3. **Organic, virus-like spread**:
   - *Simulation*: each attack has its own vein network (`attack.growth`, ridged noise,
     `growthSeed` per attack) + tips grow fastest (`fillShare` −0.4) + jitter. Tuned so
     average spread speed equals the old round fronts (same balance). Big holes were
     deliberately avoided: holes in enemy land would be annexed free by encirclement.
   - *Renderer*: freshly taken land "grows in" over 0.8 s — the color runs along thin
     curling veins first, then fills (`GROW_TICKS`, `VEIN_SCALE` in `map.frag`).
   - Balance after these changes (100 bot games): **100/100 with a winner**, median
     **10.1 min** (was 12.7), leader at minute 3 won 37%, tick 0.78 ms avg / 8.2 ms worst p99.

## 3. Lessons from this session

- The user **plays in the browser pane themselves**. Don't click/script in their tab;
  open your own tab (`tabs_create`) — but background tabs pause `requestAnimationFrame`
  (map never generates), so front your tab briefly and switch back. **Any edit to sim,
  renderer or shader hot-reloads every tab and resets the user's game** — warn them.
- The user prefers fast checks: `npm run headless` runs games in parallel (7 workers by
  default; 100 games ≈ 90 s). Use `--games 20` for quick checks.
- Bot design history and why: GAME_DESIGN §3.11 "As built". Encirclement main-territory
  rule (attack ≥ defender's home needed): GAME_DESIGN §3.8.

## 4. Next steps — milestone 1.6 (HUD & interaction)

Per ROADMAP/GAME_DESIGN §5: command bar (troop bar with 50% sweet-spot tick, hatched
send preview, growth rate, attack % presets), attack chips with odds labels
(Overwhelming…Hopeless), mini leaderboard, toasts (eliminations, attacks on you), hover
card with battle preview, right-click menu, pause menu (Esc), contextual hints. Make the
troop sweet spot very visible — it decides games (ROADMAP 1.7 notes). Then 1.7 tuning
(notes in ROADMAP), tag `phase-1`, write `PHASE_1_HANDOFF.md`.

## 5. Suggested opening prompt

> Read `docs/handoffs/PHASE_1_AFTER_1.5_HANDOFF.md`, then the handoff and docs it
> points to, and continue with Phase 1 at milestone 1.6 (HUD & interaction). Follow the
> working agreements in the handoffs.
