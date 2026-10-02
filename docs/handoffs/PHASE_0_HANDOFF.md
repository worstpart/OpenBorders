# Phase 0 → Phase 1 Handoff

> **For the next session: read this file first, then the docs it points to.** The repo
> docs are the source of truth, not chat history. Written 2026-10-01 at the end of
> Phase 0. Last commit before this handoff: `d22d726`.

---

## 1. Where we are

| | |
|---|---|
| Project | *Borderline* (placeholder name) — browser real-time territory strategy game inspired by OpenFront.io |
| Phase 0 (research, docs, render benchmark) | ✅ complete and reviewed by the user |
| Phase 1 (playable prototype vs bots) | ⬜ **start here** — milestone 1.0 (scaffold) |
| Game code written so far | None (by design) |
| Environment | ✅ ready: Node 24.19.0, npm 11.17.0 |

## 2. Read these, in this order

1. [`docs/ROADMAP.md`](../ROADMAP.md) — Phase 1 slice (in / out), milestones 1.0–1.7 with
   "done when" criteria, feature matrix, risk register.
2. [`docs/GAME_DESIGN.md`](../GAME_DESIGN.md) §3–§5 — the exact Phase 1 rules, initial
   formulas/constants, controls, HUD and visual design.
3. [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) — stack, simulation design (tick order,
   determinism rules, commands, `SimHost`), render pipeline, folder structure,
   engineering standards, testing strategy, performance budgets.
4. [`docs/DECISIONS.md`](../DECISIONS.md) — what's decided and why.
5. [`docs/OPENFRONT_RESEARCH.md`](../OPENFRONT_RESEARCH.md) — reference only, when a
   mechanic needs context (e.g. §3.9 combat, §3.10 encirclement, §3.30 rendering).

## 3. Decisions in force

| ID | Decision |
|---|---|
| D-001 | **Independent implementation.** Copy NO OpenFront code, shaders, text, UI layouts or assets; don't use their name/branding. Implement from *our* docs with *our* constants. (OpenFront = AGPL-3.0 + attribution terms; assets CC BY-SA; logo/font/sounds all-rights-reserved.) |
| D-002–D-005 | TypeScript everywhere; custom WebGL2 renderer; deterministic 10 Hz simulation; command → turn → sim pipeline with a local turn scheduler (`LocalHost`) |
| D-007, D-008 | Svelte 5 + plain CSS design tokens; Vite + Vitest; single package with folder boundaries enforced by a test |
| D-009 | First map = seeded procedural fictional continent (~1100×700) |
| D-010 | Directed attacks (priority biased to click point, `focusWeight` tunable) **and** encirclement are in Phase 1 |
| D-011 | Show real troop numbers; troops in the field count toward the cap |
| D-012 | AI uses the same commands, gets no resource bonuses |
| D-015 | Write `docs/handoffs/PHASE_N_HANDOFF.md` at the end of every phase; continue in a fresh chat |

**Still open (don't block on them):** D-006 multiplayer model (proposed: hybrid
authoritative lockstep; needed by Phase 3) · D-014 final game name.

## 4. How the user wants us to work

- The user is **not an expert game developer**. Lead the technical work, explain
  important decisions in plain language, flag problems early.
- Ask the user only when a decision **materially changes the game or project
  direction**; make sensible minor decisions yourself and note them.
- For major problems: state WHAT, WHY it matters, OPTIONS, RECOMMENDATION.
- **No fake systems.** One working mechanic beats ten placeholder buttons; label any
  placeholder clearly.
- After implementing anything: **run it, test it, check the browser console, verify it
  actually works** before saying it does.
- Git: commit at stable milestones with clear messages (end messages with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); checkpoint before big
  refactors. Keep README and docs updated. Record major decisions in `DECISIONS.md`.
- **At the end of Phase 1, write `docs/handoffs/PHASE_1_HANDOFF.md`** (same structure as
  this file) and tell the user to continue in a new chat. Also write a mid-phase handoff
  if a session gets very long.

## 5. Environment facts & gotchas

| Fact | Detail |
|---|---|
| OS / shells | Windows 11; Git Bash and PowerShell both available |
| Node / npm | **Node 24.19.0** (winget `OpenJS.NodeJS.LTS`), **npm 11.17.0**. An old global npm in `%APPDATA%\npm` used to shadow the bundled one — fixed by upgrading it; if `npm --version` ever shows 8.x again, that's why |
| Python | Not installed — use `node -e` for scripting |
| Git | Repo on `main`, no remote. Global identity configured. `core.autocrlf` converts line endings → **add `.gitattributes` (`* text=auto eol=lf`) in the scaffold** |
| Browser pane | Opening a local `file://` page turns it into a `data:` URL and **drops query strings**. Serve over HTTP instead: `.claude/launch.json` + the preview tool. Add a `dev` (Vite, port 5173) configuration in milestone 1.0 |
| Display | 165 Hz, so `requestAnimationFrame` caps at ~164 fps — compare **CPU time per frame**, not only FPS |
| Shell quoting | ⚠️ Never put backticks inside double-quoted shell strings — they execute. (This accidentally ran the winget install during Phase 0.) Use the Edit tool or a quoted heredoc (`<<'EOF'`) |
| OpenFront source | Not in the repo on purpose. If a detail must be checked, clone into the session scratchpad (never the project): `git clone --depth 50 https://github.com/openfrontio/OpenFrontIO.git` (studied commit `e02eeba`). Reference only — never copy |

## 6. Repository map (current)

```
README.md                         project intro, doc index, benchmark instructions
.gitignore
.claude/launch.json               preview config: "render-benchmark" (port 5179)
docs/ARCHITECTURE.md · DECISIONS.md · GAME_DESIGN.md · OPENFRONT_RESEARCH.md · ROADMAP.md
docs/handoffs/PHASE_0_HANDOFF.md  this file
spikes/render-benchmark/          Canvas2D vs WebGL2 benchmark (index.html + serve.mjs)
```

## 7. Key numbers to implement (from GAME_DESIGN §3 — tune later)

| Rule | Initial value |
|---|---|
| Tick | 100 ms (10/s) |
| Capacity | `M = 10,000 + 1,000 · tiles^0.6` |
| Growth/tick | `10·(1−x) + 0.044·M^0.75 · 4x(1−x)`, `x = homeTroops/M`; clamp so `home + field ≤ M` |
| Start troops | 30% of M at spawn |
| Spawn | disc radius 4 (~50 tiles); 5 s PvP protection; bots keep min distance |
| Neutral cost/tile | plains 3 · highland 4 · mountain 6; speed ∝ frontier × terrain factor × min(1, army/2000) |
| PvP loss/tile | `terrainLoss · clamp(r, 0.5, 2.5) · (lossBase + lossDensity·d)`; defender loses `d` |
| Retreat | stops at once, troops back after 2 s, −20% vs players |
| Encirclement | every 2 s, staggered; enclosed pockets (no water/edge/neutral contact) annexed |
| Elimination | below 40 tiles when attacked → absorbed; 0 tiles → dead |
| Victory | ≥ 70% of land or last standing |
| AI | 7 bots, think every 2–5 s, personalities, same commands |
| Attack % presets | 10 / 25 / 50 / 75 / 100 (keys 1–5), Q/E ±5, Shift+wheel |

`terrainLoss`, `lossBase`, `lossDensity`, `PVP_SPEED`, `focusWeight` etc. need first
values chosen during milestone 1.3; put every one in `GameRules` with a "why" comment
and pin them with golden tests.

## 8. Next steps (Phase 1, milestone 1.0 — scaffold)

1. `package.json` (type: module) with scripts `dev`, `build`, `preview`, `test`,
   `check` (TypeScript + Svelte type check), `format`. Dev deps: `vite`, `typescript`,
   `svelte`, `@sveltejs/vite-plugin-svelte`, `svelte-check`, `vitest`, `prettier`
   (+ `prettier-plugin-svelte`). Pin `engines.node` to `>=24`.
2. `tsconfig.json` (strict), `vite.config.ts`, `index.html`, `.gitattributes`,
   `.prettierrc`.
3. Folder skeleton from ARCHITECTURE §8 (`src/sim`, `src/host`, `src/client/{app,input,camera,render,ui}`,
   `tests/`, `tools/`) — only create files that do something.
4. Guard tests in `tests/`: (a) banned APIs in `src/sim` (`Math.random`, `Math.pow/exp/log/sin/cos/tan/atan2/hypot/cbrt`,
   `Date`, `performance.now`, timers); (b) import-boundary rules.
5. Minimal app shell: full-window WebGL2 canvas + a Svelte root that renders nothing
   but a placeholder start screen (clearly a placeholder).
6. Add a `dev` configuration to `.claude/launch.json`, run it in the browser pane,
   check the console is clean, run `npm test` and `npm run check`.
7. Commit: "Phase 1.0: project scaffold".
8. Continue with milestone 1.1 (simulation core) per ROADMAP.

## 9. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_0_HANDOFF.md`, then the docs it lists, and continue with
> Phase 1 starting at milestone 1.0. Follow the working agreements in the handoff.
