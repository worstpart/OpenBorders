# Decision Log

Major decisions and **why** we made them, so we don't keep changing direction.
Each entry: status, context, decision, consequences, alternatives.
Statuses: **Accepted** · **Proposed** (awaiting your confirmation) · **Superseded**.

| ID | Decision | Status |
|---|---|---|
| D-001 | Independent implementation inspired by OpenFront (no code/asset reuse) | **Proposed** |
| D-002 | TypeScript for simulation, client and server | Accepted |
| D-003 | Custom WebGL2 renderer for the map | Accepted |
| D-004 | Deterministic, fixed-tick (10 Hz) simulation | Accepted |
| D-005 | Command → turn → simulation pipeline from Phase 1 (local host) | Accepted |
| D-006 | Multiplayer model: hybrid authoritative lockstep | **Proposed** (needed by Phase 3) |
| D-007 | Svelte 5 + plain CSS design tokens for UI | Accepted |
| D-008 | Vite + Vitest; single package with enforced folder boundaries | Accepted |
| D-009 | Procedurally generated map for Phase 1 | **Proposed** |
| D-010 | Directed attacks and encirclement in Phase 1 | **Proposed** |
| D-011 | Show real troop numbers; troops in the field count toward the cap | Accepted |
| D-012 | AI uses the same commands and gets no resource bonuses | Accepted |
| D-013 | Require Node 24 LTS for development | **Proposed** (needs your action) |
| D-014 | Working title "Borderline" as a placeholder | **Proposed** |

---

## D-001 — Independent implementation (licensing Option A) · Proposed

**Context.** OpenFront's code is AGPL-3.0 with extra attribution terms; its open assets
are CC BY-SA 4.0; its logo, font, music and sounds are all-rights-reserved. Forking
would make our whole client and server AGPL (source must be offered to every player of
our hosted game) and keep their attribution notice on our screens, while bringing in
188k lines built for their business (Steam, cosmetics, payments, ranked).

**Decision.** Build our own implementation. Learn mechanics and architecture from
OpenFront, but copy no code, shaders, text, UI layouts or assets, and don't use their
name or branding. Formulas are reimplemented with our own constants and rationale.
We may later opt into their CC BY-SA maps with attribution.

**Consequences.** Full freedom over license and business model; more work up front;
must stay disciplined about not translating their files.

**Alternatives.** Option B (AGPL fork) and Option C (MIT-era fork) — see
`OPENFRONT_RESEARCH.md` §1.

---

## D-002 — TypeScript everywhere · Accepted

One language and one simulation codebase that runs in the browser and in Node (needed
for an authoritative server). Types catch errors early and document data shapes.
Alternative: Rust→WASM for the simulation — revisit only if profiling shows JS can't
meet the tick budget.

---

## D-003 — Custom WebGL2 renderer · Accepted

**Context.** We need millions of tiles, thousands of changes per tick, 60 fps, and
polished per-pixel effects. OpenFront started on Canvas2D and had to migrate to WebGL2.

**Evidence.** Phase 0 benchmark (`ARCHITECTURE.md` §4.2): with capture animations on
an 8M-tile map, Canvas2D fell to 81 fps (p95 18 ms) and used 10.7 ms of main-thread
CPU per frame; WebGL2 stayed at the display cap with ~0.07 ms per frame. Without
animation both were fine on this machine — the deciding factor is the polish we want.

**Decision.** Raw WebGL2 with a thin layer of our own. Ownership in an integer texture,
palette lookup and borders in shaders, dirty uploads, effects on the GPU. Labels in a
Canvas2D overlay for Phase 1.

**Alternatives.** Canvas2D, PixiJS, Phaser, Three.js, WebGPU (`ARCHITECTURE.md` §4.3).

---

## D-004 — Deterministic fixed-tick simulation · Accepted

10 ticks per second; seeded RNG; no non-deterministic APIs in `src/sim` (enforced by a
test); integer state; deterministic math helpers; ordered iteration; state hashes.
Enables lockstep multiplayer, server authority, replays, reproducible bugs and tests.

---

## D-005 — Command/turn pipeline from day one · Accepted

All input (human UI, AI, later network) becomes **commands**, scheduled into numbered
**turns** consumed by the simulation. Phase 1 runs a local turn scheduler (`LocalHost`)
— the same shape a server will have. Commands carry *percentages*, never absolute troop
counts; the simulation validates everything.

---

## D-006 — Hybrid authoritative lockstep for multiplayer · Proposed

**Context.** OpenFront's relay-only lockstep is extremely cheap but leaves outcomes to
client votes and makes reconnects slow. A pure authoritative-state server is simple to
reason about but bandwidth-heavy for this genre (thousands of tile changes per tick).

**Decision (proposed).** The server runs the same deterministic simulation, validates
and stamps commands before relaying them as turns, compares client hashes to its own,
resyncs diverging clients with snapshots, serves snapshots for reconnect/spectate, and
decides outcomes. Clients simulate locally for rendering.

**Consequences.** Server CPU per game (not bandwidth); requires cross-engine
determinism (tested). Fallback: authoritative state deltas.

---

## D-007 — Svelte 5 + CSS design tokens · Accepted

Fine-grained reactivity suits HUD numbers updating 10×/s; built-in transitions and
tweened values support the polished feel; scoped CSS + tokens give a bespoke look with
few dependencies. Alternatives: React, Lit, Solid, Preact+signals, vanilla DOM,
Tailwind.

---

## D-008 — Vite + Vitest, single package · Accepted

Fast iteration with minimal configuration. One `package.json`; module boundaries
(`sim`, `host`, `client`, `server`, `shared`) enforced by an import-scanning test
instead of a multi-package workspace. Can split later if needed.

---

## D-009 — Procedural map for Phase 1 · Proposed

A seeded fictional continent: no licensing work, size/shape tunable for fun, identical
on every machine from the seed. Real-world maps come later via our own pipeline from
public-domain data (or OpenFront's CC BY-SA maps with attribution, if we choose).

---

## D-010 — Directed attacks + encirclement in Phase 1 · Proposed

Directed attacks (priority biased toward the click point) answer OpenFront's
longest-standing request and make *position* matter; encirclement makes border geometry
matter. Both are tunable (`focusWeight = 0` restores whole-border attacks).

---

## D-011 — Real numbers; field troops count toward the cap · Accepted

The HUD shows exactly what the simulation uses (OpenFront hides a ÷10). Troops inside
attacks/boats count toward capacity, closing the stockpiling exploits documented in
OpenFront, while growth stays based on the home pool so committing troops above the
sweet spot still increases regeneration.

---

## D-012 — Fair AI · Accepted

Bots issue the same commands, see the same information, and get no troop/gold
multipliers at any difficulty. Difficulty comes from reaction time and decision quality.

---

## D-013 — Node 24 LTS required · Proposed (needs your action)

The machine has Node 16.13.0 (end-of-life since 2023). Current Vite, Vitest and Svelte
need Node 20+. Options: install Node 24 LTS from nodejs.org, run
`winget install OpenJS.NodeJS.LTS`, or use a version manager (nvm-windows / fnm) if
other projects still need Node 16.

---

## D-014 — Working title · Proposed

"Borderline" as a codename until you choose a name. Must not resemble "OpenFront".
