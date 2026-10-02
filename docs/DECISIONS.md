# Decision Log

Major decisions and **why** we made them, so we don't keep changing direction.
Each entry: status, context, decision, consequences, alternatives.
Statuses: **Accepted** · **Proposed** (awaiting your confirmation) · **Superseded**.

| ID | Decision | Status |
|---|---|---|
| D-001 | Independent implementation inspired by OpenFront (no code/asset reuse) | **Accepted** 2026-10-01 |
| D-002 | TypeScript for simulation, client and server | Accepted |
| D-003 | Custom WebGL2 renderer for the map | Accepted |
| D-004 | Deterministic, fixed-tick (10 Hz) simulation | Accepted |
| D-005 | Command → turn → simulation pipeline from Phase 1 (local host) | Accepted |
| D-006 | Multiplayer model: hybrid authoritative lockstep | **Proposed** (needed by Phase 3) |
| D-007 | Svelte 5 + plain CSS design tokens for UI | Accepted |
| D-008 | Vite + Vitest; single package with enforced folder boundaries | Accepted |
| D-009 | Procedurally generated map for Phase 1 | **Accepted** 2026-10-01 |
| D-010 | Directed attacks and encirclement in Phase 1 | **Accepted** 2026-10-01 |
| D-011 | Show real troop numbers; troops in the field count toward the cap | Accepted |
| D-012 | AI uses the same commands and gets no resource bonuses (except Tribes, D-017) | Accepted, amended 2026-10-02 |
| D-013 | Require Node 24 LTS for development | **Accepted** 2026-10-01 (installed 24.19.0) |
| D-015 | A handoff document after every phase; each phase starts in a fresh chat | **Accepted** 2026-10-01 |
| D-014 | Name: **OpenBorder** (was the working title "Borderline") | **Accepted** 2026-10-02 (user) |
| D-016 | Phase 2 order: big lobbies → Tribes & Nations → alliances → teams | **Accepted** 2026-10-02 |
| D-017 | Tribes are weaker by stats; Nations stay fair | **Accepted** 2026-10-02 |
| D-018 | Alliances: timed and renewable, no shared victory, betrayal costly | **Accepted** 2026-10-02 |
| D-019 | Teams: fixed sides that win on combined land; alliances unchanged across teams; tribes teamless | **Accepted** 2026-10-02 (user) |

---

## D-001 — Independent implementation (licensing Option A) · Accepted 2026-10-01

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

## D-009 — Procedural map for Phase 1 · Accepted 2026-10-01

A seeded fictional continent: no licensing work, size/shape tunable for fun, identical
on every machine from the seed. Real-world maps come later via our own pipeline from
public-domain data (or OpenFront's CC BY-SA maps with attribution, if we choose).

---

## D-010 — Directed attacks + encirclement in Phase 1 · Accepted 2026-10-01

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

*Amended by D-017 (2026-10-02):* this still holds for **Nations** (the real opponents);
**Tribes** — filler bots — are deliberately weaker by stats.

---

## D-013 — Node 24 LTS required · Accepted 2026-10-01

The machine had Node 16.13.0 (end-of-life since 2023); current Vite, Vitest and Svelte
need Node 20+. Installed **Node 24.19.0** via `winget install OpenJS.NodeJS.LTS`
(replacing Node 16). An old global npm 8.1.4 in `%APPDATA%\npm` shadowed the bundled
npm, so it was upgraded to **npm 11.17.0** (the version bundled with Node 24).

---

## D-014 — Name: OpenBorder · Accepted 2026-10-02

**History.** Phase 0 used "Borderline" as a codename, with the note that the final name
must not resemble "OpenFront".

**Decision (user, 2026-10-02).** The game is called **OpenBorder** — title, start screen,
README, package name and the dev debug hook (`window.__openborder`) were renamed.

**Risk, flagged when it was chosen.** "OpenBorder" follows the same "Open + territory
word" pattern as "OpenFront", the game we are inspired by. Players may link the two, and
OpenFront's team could object to a confusingly similar name on a public launch. Our
code, art and text stay independent (D-001), which is what licensing cares about; the
name is a trademark/branding question. **Revisit before any public launch (Phase 5):**
check for conflicts, and keep a fallback name ready. Old handoffs still say "Borderline".

---

## D-015 — Phase handoffs and fresh chats · Accepted 2026-10-01

**Context.** Long sessions fill the AI's context window; quality drops as it fills.

**Decision.** At the end of every phase (and whenever a session gets long), write
`docs/handoffs/PHASE_N_HANDOFF.md` with everything the next session needs — state,
decisions, environment, gotchas, exact next steps — commit it, and continue in a new
chat that starts by reading that handoff. The docs, not chat history, are the source
of truth.

---

## D-016 — Phase 2 starts with big lobbies, Tribes & Nations, alliances, teams · Accepted 2026-10-02

**Context.** After playtesting Phase 1 the user asked for up to 125 bots, OpenFront-style
*Tribes* (many weak filler bots) and *Nations* (smarter opponents), teams, and alliances
that last and work like OpenFront's (timed, renewable, betrayal marks a traitor).

**Decision.** These are new systems, not tuning, so they are **not** added to Phase 1:
Phase 1 finishes its tuning (milestone 1.7) and is tagged first. They become the **first
milestones of Phase 2** (2.0 big lobbies → 2.1 Tribes & Nations → 2.2 alliances → 2.3
teams), ahead of the economy, buildings and boats (ROADMAP). Teams move up from Phase 3
because team games against bots don't need a server. Scale comes first because tribes
only make sense with many players, and alliances need many opponents to matter.

**Clean room.** We reproduce the *ideas* documented in `OPENFRONT_RESEARCH.md` §3.19–3.22
(alliance timings, traitor debuff, tribe/nation roles) with our own design and code.

**Open within it.** Whether tribes get stat handicaps (OpenFront's do) or stay fair and
are simply simpler (D-012) — decided in the 2.1 design note.

---

## D-017 — Tribes are weaker by stats; Nations stay fair · Accepted 2026-10-02

**Context.** Milestone 2.1 adds two AI tiers (D-016). OpenFront's Tribes are weak by
stats (a third of the troops, half the growth, cheaper to attack); D-012 said no bot gets
stat changes. Asked in the 2.0 report: "(a) fair tribes, simply simpler, or (b) weaker
tribes like OpenFront's" — the user chose **(b)**.

**Decision.** Tribes get stat handicaps, with our own numbers in `rules.tribe`
(GAME_DESIGN §3.13): smaller troop capacity, slower growth, and land that costs less to
take for anyone who isn't a tribe. They play a simple, slow AI. **Nations** keep D-012:
no bonuses or penalties at any difficulty; difficulty is reaction time + decision quality.
Humans are never handicapped.

**Consequences.** Tribes reliably act as "food" that fills the map and makes attacking
pay; a lobby's real opposition is its Nations. The HUD must show who is a tribe (hover
card, leaderboard) so players can tell easy prey from rivals. Battle estimates (`battle.ts`)
include the tribe discount so the odds the HUD shows stay true.

**Alternatives.** (a) fair tribes that are only simpler — rejected by the user; tribes
would still hold full armies and stall attackers.

---

## D-018 — Alliances: timed and renewable, no shared victory, betrayal costly · Accepted 2026-10-02

**Context.** Milestone 2.2 (D-016) adds alliances. The handoff left three questions open:
how many alliances at once, whether allies share a win, and what "traitor" means in numbers.

**Decision** (GAME_DESIGN §3.14). Requests expire after 20 s (30 s before asking the same
player again); alliances last 5 min and are extended only if **both** renew in the last
30 s. **No cap** on alliances for players (nations limit themselves to two). **Only your
own land counts** for victory — a shared win is what teams (2.3) are for; nations never
ally or renew when only two contenders remain, so a game can't stall on a final pair of
allies. Breaking an alliance makes you a **traitor for 30 s**: attackers pay 0.6× losses
and move faster; tribes attack neighbouring traitors first; nations weigh traitors 2× as
targets (the user asked for this during the milestone) and the betrayed nation holds a
5-minute grudge. Whether a nation is the kind to betray a given ally is decided once per
alliance (difficulty × personality), so betrayals stay occasional.

**Consequences.** Games run a little longer (see ROADMAP 2.2 results); `rules.diplomacy
.enabled = false` reproduces the 2.1 game exactly, which keeps balance comparisons honest.

**Alternatives.** Permanent alliances until broken (rejected: blocs would freeze the map);
allies' land counted together (rejected: that is teams mode, 2.3); a per-think random
betrayal chance (rejected: over a 5-minute alliance nearly every one ended in betrayal).

---

## D-019 — Teams: fixed sides, combined land, alliances unchanged · Accepted 2026-10-02

**Context.** Milestone 2.3 (D-016) adds a Teams mode. Asked at the start of the milestone:
whether alliances still exist in team games, where tribes fit, and whether teammates
start together. The user's answers: alliances work **the same as in free-for-all** and
must always be requested; **allied teams can't combine to win**; tribes belong to no team
(ally them early for safe land, they get eaten eventually); **nations spawn at random**
and humans pick their own spot; teams are how friends will queue together later.

**Decision** (GAME_DESIGN §3.15). 2–8 teams; you and the nations are dealt round-robin,
tribes have no team. Teammates are permanently friendly (no attacks, no encirclement —
the alliance checks become `areFriendly` = same team or allied) and win together when
their combined land reaches the goal (70% with the usual anti-stall decline), or when no
other team has a player left (tribes can't win and don't block it). Alliances across
teams follow §3.14 unchanged; nations count teams as the "contenders" for their
"never ally when only two are left" rule. Team-aware nations prefer enemies attacking a
teammate and enemies a teammate already attacks. Spawning is unchanged.

**Consequences.** Free-for-all games are unchanged (a world with no teams plays exactly
as in 2.2 — the regression check). `World.winner` stays a player (the winning team's
biggest member) and `World.winningTeam` names the team, so FFA code paths don't change.

**Alternatives.** No alliances in team games (my first recommendation — rejected by the
user: politics between teams stay); tribes split among the teams (rejected: less food,
and tribes are filler); teams spawning in their own regions (rejected by the user: nations
spawn at random, humans choose).

---

## D-020 — Economy: land-linked gold, Mobilize, gifts, full loot · Accepted 2026-10-02

**Context.** Milestone 2.4 (§6.1, Q6) adds gold before buildings exist (2.5). Asked at the
start: whether troops can be donated at all, or only gold. During the milestone the user
asked that conquering a player give **all** their leftover gold, with an animation.

**Decision** (GAME_DESIGN §3.16). Income E2: 10 + 0.8·√tiles gold per tick (tribes half,
never spent). Mobilize: 1 gold per troop, never past the cap (HUD: 10% of capacity per
click, key M). Donations to allies and teammates — **troops too** (the user's choice),
capped by the friend's room, and gold — each kind to each friend at most every 10 s.
Loot: the eliminator takes all the victim's gold; the capturer's border shimmers gold and
"+gold" rises from the captured land.

**Consequences.** `rules.economy.enabled = false` reproduces 2.3. Gold is one more number
in the hash and the frame; buildings (2.5) will spend the same gold.

**Alternatives.** Gold-only donations (rejected by the user: rescuing a friend should be
instant); flat income E1 (less legible); half the loot (my first note; the user asked for all).
