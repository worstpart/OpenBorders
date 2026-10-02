# Phase 1 mid-point handoff (after milestone 1.4)

> **For the next session: read this file first, then the docs it points to.** The repo
> docs are the source of truth, not chat history. Written 2026-10-01 after milestone 1.4.
> Last commit before this handoff: `73f75ab`. The Phase 0 handoff
> ([`PHASE_0_HANDOFF.md`](PHASE_0_HANDOFF.md)) still describes the working agreements.

---

## 1. Where we are

| | |
|---|---|
| Project | *Borderline* (placeholder name) — browser real-time territory strategy game |
| Phase 0 (research, docs, benchmark) | ✅ |
| Phase 1 milestones 1.0–1.4 | ✅ scaffold · simulation core · rendering & camera · expansion & combat · encirclement/elimination/victory |
| **Next** | ⬜ **milestone 1.5 — AI opponents** (then 1.6 HUD, 1.7 playtest & tune) |
| Tests | 108 passing (`npm test`), type check clean (`npm run check`), Prettier clean |
| What works in the browser | Start screen → pick a start → expand / attack (keys 1–5, Q/E, Shift+wheel) → fronts, capture flash, labels → encircle → win at 70% → victory card → Play again |
| What doesn't exist yet | Bots never act (they only spawn) — so no incoming attacks, no defeat path tested in the browser; no toasts, leaderboard, troop bar, hover card, pause menu (1.6) |

## 2. Read these, in this order

1. [`docs/ROADMAP.md`](../ROADMAP.md) — milestones 1.5–1.7 and the **"Notes collected for
   1.7"** list under the milestone table.
2. [`docs/GAME_DESIGN.md`](../GAME_DESIGN.md) §3.11 (AI) — and §3.5–3.10 for the rules as
   built (each has an "As built" note where we refined the draft).
3. [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §5.3 tick order, §5.4.1–5.4.2 (as-built
   simulation and attack model), §4.4 (as-built renderer), §10 testing.
4. [`docs/DECISIONS.md`](../DECISIONS.md) — unchanged since Phase 0.

## 3. Decisions in force

Everything in the Phase 0 handoff §3 still holds (D-001 clean-room, TypeScript, WebGL2,
deterministic 10 Hz sim, command/turn pipeline, Svelte 5, Vite/Vitest, procedural map,
directed attacks + encirclement, fair AI, handoffs). Choices made during 1.0–1.4 (all
documented in the docs above; none needed the user's sign-off):

| Choice | Where documented |
|---|---|
| TypeScript pinned to 6.0.x (svelte-check doesn't support TS 7 yet); `erasableSyntaxOnly` so tools can run sim code with plain `node` | ARCHITECTURE §3, §5.4.1 |
| Fronts use *ready times* in continuous time, not a per-tick budget; directed attacks = `focusSpread` + `focusPull`; `fillShare` 0.29 keeps fronts round | GAME_DESIGN §3.7, ARCHITECTURE §5.4.2 |
| Pace: neutral 3 ticks/tile, PvP 4 ticks/tile at even odds | GAME_DESIGN §3.5–3.6 |
| `lossDensity` 1.2 (Lanchester square law: ~10% more troops needed to take everything) | GAME_DESIGN §3.6 |
| Encirclement: pockets fall to any encloser; a main territory only to a single encloser | GAME_DESIGN §3.8 |
| Absorption below 40 tiles only if ≤ 25% of peak land (no spawn-rush exploit) | GAME_DESIGN §3.9 |
| Troop amounts are floats computed with + − × ÷ / sqrt only (still deterministic) | ARCHITECTURE §5.4.2 |

Still open (don't block on them): D-006 multiplayer model (Phase 3), D-014 final name.

## 4. How the user wants us to work

Unchanged — see [`PHASE_0_HANDOFF.md`](PHASE_0_HANDOFF.md) §4: the user is not an expert
game developer; lead, explain in plain language, ask only on decisions that materially
change the game; no fake systems; **run, test, check the console and verify in the
browser** before claiming something works; commit at stable milestones (end messages with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); keep docs current; write
`docs/handoffs/PHASE_1_HANDOFF.md` at the end of Phase 1 and tell the user to continue in
a new chat.

## 5. Environment facts & gotchas

Everything in Phase 0 handoff §5 still applies (Node 24.19 / npm 11.17, no Python —
use `node`, never backticks inside double-quoted shell strings, LF via `.gitattributes`).
New:

| Fact | Detail |
|---|---|
| Dev server | `.claude/launch.json` → `"dev"` (Vite, port 5173). Start it with the preview tool, not Bash |
| Running sim code in Node | `node some-script.ts` works directly (type stripping). From the scratchpad, import with `file:///C:/Users/yojvz/Downloads/openfront%20remake/src/...` |
| Browser test tool quirks | Its `scroll` action seems to click first (it once merged an extra attack) — zoom with `javascript_tool` + `WheelEvent` on `#map` instead. Its region zoom isn't supported. Screenshots are 800×757 for a 1345×1274 viewport (×1.68 for CSS px) |
| Console buffer | `read_console_messages` keeps an old error (`renderer.setClearColor is not a function`, URL `main.ts?t=1790902732013`) from a mid-edit hot reload in milestone 1.2 — it's stale. Log a marker (`console.log('MARKER')`) before a check and only trust messages after it |
| Hot reload | Editing anything imported by `client.ts` (sim, renderer, shaders) reloads the page and loses the running game; re-run the scenario |
| **Dev-only debug hook** | `window.__borderline` (dev builds only; verified absent from `npm run build`): `setSpeed(x)`, `pause()`, `resume()`, `frame()` (latest tick frame), `renderer()` (incl. `map.ownerCapture` = interleaved owner/capture-tick per tile; water = 65535), `send(command)` as the local player. Used for slow-motion checks and scripted autoplay (see §8) |
| Prettier vs scripted edits | Prettier reflows long lines, so a later exact-string replace may not match — re-read the file or use the Edit tool after formatting |

## 6. Repository map (current)

```
src/sim/            deterministic simulation (no DOM, no packages; guard-tested)
  rules.ts          every tunable constant with a "why"
  world.ts          World, Player, Attack, setOwner (counts, borders, hash, change log)
  tick.ts           system order; commands.ts; events.ts; frame.ts; stateHash.ts
  map/              gameMap.ts, noise.ts, generate.ts (procedural continent)
  math/             rng.ts (sfc32), detmath.ts (log/exp/pow), hash.ts
  systems/          spawn, troops, attacks (+ tileQueue), encirclement, elimination, victory
src/host/           host.ts (SimHost), localHost.ts (turn scheduler; realtime or manual)
src/client/         main.ts, format.ts
  app/              client.ts (wiring + rAF loop + debug hook), uiState.svelte.ts, players.ts, attackPercent.ts
  camera/ input/    camera.ts; controls.ts, gesture.ts
  render/           renderer.ts, shaders/map.{vert,frag}, terrainTexture.ts, labels.ts, perfOverlay.ts
  ui/               App.svelte, tokens.css, hud/ (YouChip, SpawnPrompt, AttackChips), screens/ (StartScreen, EndCard)
tests/              guards/, helpers/ (asciiMap.ts, source.ts), sim/, client/, host/
docs/               ARCHITECTURE · DECISIONS · GAME_DESIGN · OPENFRONT_RESEARCH · ROADMAP · handoffs/
spikes/             Phase 0 render benchmark (never imported)
```

## 7. Key numbers in force (GameRules, `src/sim/rules.ts`)

| Rule | Value |
|---|---|
| Capacity / growth | `M = 10,000 + 1,000·L^0.6`; growth `10·(1−x) + 0.044·M^0.75·4x(1−x)`, x = home/M; field troops count toward M |
| Spawn | radius 4 (49 tiles), start at 30% of M, 5 s protection, random spawns ≥ 70 tiles apart |
| Neutral | 3/4/6 troops per tile; 3 ticks per tile on plains, ×1.25 highland, ×1.67 mountain; full speed at ≥ 2,000 troops |
| PvP | loss `terrain × clamp(r,0.5,2.5) × (3 + 1.2·d)`, defender loses d; 4 ticks/tile × terrain × clamp(r,0.8,8) |
| Attacks | focusSpread 0.35, focusPull 1, fillShare 0.29, noise 0–1.5 ticks, retreat 20 ticks −20% (players only) |
| Encircle / eliminate / win | check every 20 ticks; absorb < 40 tiles and ≤ 25% of peak when attacked; win at 70% land or last standing |

## 8. Next steps — milestone 1.5 (AI opponents)

**Done when (ROADMAP):** 100 bots-only games finish with a winner, no exceptions, within
the tick budget.

1. **Bot brain in `src/sim/ai/`** (runs inside the deterministic sim, tick step 7, emits
   the *same* commands as humans — D-012; use `world.rng` only). Think every 2–5 s,
   staggered per bot. Suggested structure: `ai/bot.ts` (state per bot: next think tick,
   personality), `ai/personalities.ts` (Expander, Aggressor, Turtle, Opportunist =
   thresholds and target weights), `ai/decide.ts` (utility choice). Bot commands should be
   queued and applied through the same validation path as human commands (e.g. a
   `world.pendingCommands` list applied at the start of the next tick).
2. **Must manage the sweet spot.** The biggest lesson from 1.4: a player who keeps
   sending most of their troops stays near an empty pool and barely grows (a scripted
   player took ~36 min instead of ~4 to win). Bots should attack/expand only above a
   trigger share of capacity (e.g. 45–60%) and keep a reserve.
3. Behaviours: expand into neutral land while it exists (aim at big open areas, avoid
   mountains); attack when above trigger, choosing targets by weakness (low density, at
   war elsewhere), proximity and threat; retaliate against attackers; avoid hopeless
   attacks (use the Lanchester rule: need A² > 1.2·D²); retreat hopeless attacks; use
   directed focus points (e.g. toward a target's thin part, to cut pockets off).
4. **Headless runner** `tools/headless.ts` (runs with plain `node tools/headless.ts`):
   N bots-only games on the reference map with different seeds; report winner, game
   length, lead changes, eliminations over time, tick time avg/p99/max. Use it for the
   "100 games" criterion and later for 1.7 tuning.
5. Browser check: bots expand and attack you; verify incoming-attack chips, opposing
   attacks cancelling, the defeat path (eliminated card → Keep watching → game continues
   to a bot victory → Play again).
6. Update docs (GAME_DESIGN §3.11 "As built", ROADMAP 1.5 ✅), commit "Phase 1.5: AI
   opponents".

Then 1.6 (HUD: command bar with troop bar + sweet-spot tick + send preview, leaderboard,
toasts, hover card with battle odds, context menu, pause menu, hints) and 1.7 (tune with
the headless runner, see ROADMAP notes), then write `PHASE_1_HANDOFF.md`.

## 9. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_1_MIDPOINT_HANDOFF.md`, then the docs it lists, and continue
> with Phase 1 at milestone 1.5 (AI opponents). Follow the working agreements in the
> handoffs.
