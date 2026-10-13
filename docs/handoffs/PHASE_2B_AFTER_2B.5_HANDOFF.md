# Phase 2B handoff — after milestone 2B.5 (Missile Silo I–III)

> **For the next session: read this file first.** It replaces
> [`PHASE_2B_AFTER_2B.4_HANDOFF.md`](PHASE_2B_AFTER_2B.4_HANDOFF.md); the **working
> agreements (§4), environment facts (§5) and repository map (§6) of
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md) still apply** — read those sections too.
> Written 2026-10-12. The repo docs are the source of truth, not chat history.

---

## 1. Where we are

| | |
|---|---|
| Phase 2 | ✅ tag `phase-2` |
| 2B.0 – 2B.4 (flights, art, Airport I–III, SAM I–III, flak, strikes, D-029) | ✅ |
| **2B.5 Missile Silo I–III** | ✅ 18e5bcc (ROADMAP "Milestone 2B.5 result", GAME_DESIGN §3.17.8 "As built (2B.5)", ARCHITECTURE §5.7, D-030) |
| Explosion particles | ✅ the user's request during 2B.5 (client-only, `render/particles.ts`) |
| **Next** | ⬜ **2B.6 — Port III Naval Base + strategic balance pass** (ROADMAP row) — the last 2B milestone, ends with the Phase 2B handoff and a playtest approval |
| Tests | 473 passing, type check clean, Prettier clean, build OK |

## 2. What happened this session

- Asked the user to playtest 2B.4 + D-029 (no answer yet — **ask again**, together with 2B.5).
- Built 2B.5 end to end, bots first: `systems/missiles.ts` (launch, interception rules, strike
  missile / bunker buster / warhead, scorched land), `ai/missile.ts`, Silo valuation in
  `ai/build.ts`, Factory III war production (`buildings.ts` `producedTicks`), SAM II/III against
  missiles (the old "Later:" lines are gone), the HUD (Silo card, aiming previews, threats, early
  warning, toasts, missile sprites turned to their heading, blasts, scorched circles).
- **User request mid-milestone:** "particle effects on explosions too, airstrikes, missiles,
  blocked missiles by SAMs, anywhere where there will be an explosion" → placed in 2B.5 (the
  explosion visuals were being built), done: `ParticleSystem` with sparks, fire, smoke, debris
  and a shock ring per explosion kind, fed from events in `client.ts` `explode()`.
- Decisions I took (D-030, minor, user may revisit): the warhead spares the launcher's and
  teammates' land but hits allies (alliance breaks); missiles hit enemies only; SAM I can't stop
  missiles; a warhead uses a slot too.

## 3. Start of the next session

1. **Ask the user to playtest 2B.4 + 2B.5** (short): an airborne assault that the enemy
   counter-attacks (D-029); an air strike; then a Missile Silo — strike missile on a cluster of
   buildings, a bunker buster through an enemy SAM II (fire two at once to saturate it), and the
   warhead in a long game. Report: are missiles too strong / too weak for their price? Does the
   warhead feel fair (it spares your own land, D-030)? Do the explosions look good, too much,
   too little? Is the Silo reachable (~1.95M with escalation for level III)?
2. **2B.6 — Port III Naval Base + balance pass** (ROADMAP row): coastal fortification, warship
   patrol, **warships capture non-allied trade ships** (D-026), then a balance/AI pass across all
   buildings and the Phase 2B handoff. **Warships have no art** — ask the user first (memory:
   project-icon-pack).

## 4. Things to know

| Fact | Detail |
|---|---|
| Missile code | `systems/missiles.ts`: `missileProblem` (+ texts, shared with HUD/AI), `applyLaunchMissile`, `landMissile`, `warheadTiles`, `scorchedFactor`, `expireScorched`, `samStops`, `siloRange` (Infinity = whole map), `WARHEAD_SLOT` 0. `flights.ts` calls `landMissile`; SAMs fire at missiles only if `samStops`; flak skips them |
| Rules | `rules.buildings.types.silo`; SAM levels `interceptsMissiles` / `interceptsWarheads` / `earlyWarning`; Factory III `warProductionRange` 60 / `warProductionFactor` 0.75; `rules.flights.missile*`, `busterLevels`, `warhead*`, `scorched*`; `rules.ai.missileValueFactor` 2, `warheadLeaderShare` 0.33; `rules.ai.build.siloWorth` 0.4 |
| Hash | `world.scorched` hashed only while non-empty; missiles are ordinary flights. Flights-off games replay 6cea105 (2B.4) exactly — the next regression baseline is 18e5bcc |
| Headless | Islands median 22.7 min, 0.9 Silos/game, ~2 missiles, ~0.03 warheads; Continent 9.0, Two lands teams 5.0 — no Silos (short games). `airPerGame` has the missile counters |
| Particles | `render/particles.ts` (`MAX_PARTICLES` 2500; presets intercept/building/strike/destroyed/missile/warhead). Drawn by `render/flights.ts`; smoke first so fire shows on top. Client-only (`Math.random` allowed outside `src/sim`) |
| Browser test that worked | Islands, Easy, **0 tribes**, FFA 7 nations; spawn by script at tile 39471, ally nations 2–5 (`sendAs` allianceRequest + `send` reply) and an interval making them donate gold; Silo III by ~tick 4,000 at 10×. For an enemy SAM II: give an *ally* gold, `sendAs` it to build/upgrade a SAM, then `allianceBreak` it (a request to a non-ally can hit the request cooldown). Map clicks are ignored while paused — resume at 0.5× to click. **Slow-motion trick for screenshots:** right after the event, `performance.now = () => base + (real() - base) * 0.05` (restore afterwards) |
| Shell | Patches as `.cjs` files written with the Write tool; never inline scripts containing apostrophes or backticks (two failures this session, one ran a `/**` glob) |
| Dev server | this session used **`dev-6` (port 5178)**, left running; `dev-7` (5181) belonged to another chat |

## 5. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2B_AFTER_2B.5_HANDOFF.md` (and the sections of
> `PHASE_2_HANDOFF.md` it points to), then start milestone 2B.6 (Port III Naval Base +
> strategic balance pass). Follow the working agreements.
