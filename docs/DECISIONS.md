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
| D-020 | Economy: land-linked gold, Mobilize, gifts (troops too), full loot | **Accepted** 2026-10-02 |
| D-021 | Building system: 7 buildings × 3 named levels incl. SAM, Silo, Airport; air phase (2B) before multiplayer, bots first | **Accepted** 2026-10-02 (user's answers) |
| D-022 | Border Defense = posts that fortify the owner's border inside a zone, drawn as walls | **Superseded** by D-024 (2026-10-02) |
| D-023 | Air rules: sender-only airports, deterministic SAM interceptors, level = health; troop gifts only over a shared border or by airlift | **Accepted** 2026-10-02 (user) |
| D-024 | Border Defense = walls the player draws point by point (Clash of Clans style); hard tiles that hold attacks and break piece by piece | **Accepted** 2026-10-02 (user) |
| D-025 | Islands on every generated map; boats from any coast land as beachhead attacks; Ports make them better | **Accepted** 2026-10-02 (user: islands always) |
| D-026 | Trade ships between players' Ports (OpenFront-style) in 2.8; warships capture non-allied ones in 2B.6; real-world maps parked | **Accepted** 2026-10-06 (user) |
| D-027 | Sound = alert sounds only, synthesized in the browser; talking = emojis + map pings (no quick chat, no free text) | **Accepted** 2026-10-06 (user) |
| D-028 | Art: the user's icon pack (WW1 → WW2 → Modern eras = levels I → III) becomes the building and vehicle art, in milestone 2B.0b | **Accepted** 2026-10-06 (user's request; placement mine) |
| D-029 | Landed armies (airborne, boats) don't collide with counter-attacks; the pocket is taken tile by tile | **Accepted** 2026-10-12 (user's playtest of 2B.4) |

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

---

## D-021 — Building system with three levels, air and missiles; roadmap placement · Accepted 2026-10-02

**Context.** Before starting milestone 2.5 the user asked for a building system that stays
recognisably OpenFront but deeper: Housing, Factory, Port, Border Defense, SAM, Missile
Silo and a new **Airport**, each with **three levels**, plus air transport, airborne
invasions, air strikes and SAM interception. Our earlier plan (GAME_DESIGN §6.2, feature
matrix) said silos and SAMs were "not planned before Phase 4". OpenFront's source
(re-checked 2026-10-02) has unlimited stacked levels and no aircraft.

**Proposal** (GAME_DESIGN §3.17). Exactly three named levels; levels II and III add an
ability where it makes sense; one definitions table in `rules.buildings`; prices sized to
our economy (first L1 ~1 min, L2 ~3–4 min, L3 ~6–7 min, Airport III/Silo III only for
leaders in long games) with +25% per level owned of a type. Roadmap: 2.5 framework +
Housing + Factory, 2.6 Border Defense, 2.7 boats + Port I–II (the beachhead attack),
then a new **Phase 2B — Air & strategic warfare** (flights, Airport I–III, SAM I–III,
Silo I–III, Port III), placed **before** Phase 3 multiplayer (user). Missile Silos are not
in 2.5: a silo without missiles, flights and interception would be a fake system.

**Consequences.** Supersedes "no silos/SAMs before Phase 4". Phase 2 gains 2.10 (playtest
& balance); old 2.6–2.8 become 2.7–2.9. Games will likely get longer — measured every
milestone; whether L3 warfare should be common (longer games) is an open question for
the user.

**User's answers (2026-10-02).** The air & strategic phase comes **before** multiplayer
(Phase 2B, after Phase 2) and is built **bots-first**: nations place airports and SAMs and
fly missions in headless and spectated games before the human controls are added. Longer
games are fine (provisional target ~15–20 min, GAME_DESIGN §3.17.12).

**Amended after the 2.5 playtest (user):** captured buildings are **adopted at their
level** by whoever takes the tile (the design said one level lower); building happens from
a build bar with the building following the mouse (OpenFront's way).

**Alternatives.** Unlimited OpenFront-style stacking (opaque); everything in Phase 2
(would delay boats and maps); air phase after multiplayer (my first recommendation —
multiplayer's risks would be found earlier; the user preferred the full solo game first).

---

## D-022 — Border Defense as fortification zones drawn on the border · Accepted 2026-10-02

**Context.** The user wants defense to fortify *borders* visibly instead of being a dot
inside the territory, and asked how it should behave when borders move, territory changes
hands, fortified players meet, allies border it or new enemies arrive.

**Proposal** (GAME_DESIGN §3.17.6, ARCHITECTURE §5.7). A Border Defense post covers a
circle; the owner's tiles in it are fortified at the post's level (attackers ×1.5 / ×2 /
×2.5 losses and slower fronts); the owner's border segments inside it are drawn as a wall
patterned by level. The fortification is **derived** from (posts, ownership) every time
ownership changes, so it follows the moving border with no special cases; the post is
destroyed when its tile falls; overlapping posts don't stack; it never applies to friends
or to neutral expansion. One zone-modifier hook in the attack code also carries
suppression from air strikes and missiles later.

**Alternatives.** Player-painted border segments (go stale the moment the border moves;
more micromanagement); per-cell walls stored on tiles (needs rules for every capture);
OpenFront's circle without a wall (not readable on the border, which the user asked for).

---

## D-023 — Air rules; troop gifts only over a shared border or by airlift · Accepted 2026-10-02

**Context.** Airports raise questions the user asked us to settle: does the receiver need
an airport, how SAMs interact with aircraft, how damage works, and — found while reading
our own code — troop gifts (D-020) already reach **any** ally instantly, which would make
an Airport I airlift pointless.

**Proposal** (GAME_DESIGN §3.17.7). Only the sender needs an airport. Flights are visible,
straight-line and take time. SAMs fire a few interceptors (1/2/3) that always destroy one
plane each and reload — no random hit chances, no stacking multipliers (as OpenFront does
for nukes). Buildings have no HP: a hit costs one level. **Troop gifts require a shared
border or an airlift** — the user's answer (2026-10-02): no boat route; gold gifts stay
instant everywhere. This amends D-020; the border rule ships in milestone 2.5, airlifts in
2B.1.

**Alternatives.** Percentage interception chances (random, harder to read); keep instant
troop gifts and make Airport I something else (e.g. faster gifts only — a weak level).

---

## D-024 — Drawn walls replace Border Defense posts · Accepted 2026-10-02

**Context.** While milestone 2.6 was being checked in the browser (posts with a zone that
fortified the owner's border, D-022 — built and tested), the user asked for walls placed
point by point — A, B, C … until the shape is built — that buff defence and that enemies
push through, like Clash of Clans walls.

**Decision** (user, 2026-10-02, GAME_DESIGN §3.17.6). Walls **replace** the posts. A wall
is a line of tiles drawn on your own land (anywhere, not only at the border) by clicking
corner points; each piece is a straight line between two points. Wall tiles are **hard**:
an attack must hold at a wall tile for a few seconds and pay extra troops to break it, so
fronts flow around the ends and through gaps, and a closed wall forces a break-through.
A wall tile taken by anyone breaks (a gap); the rest stands. Walls are stored state (not
derived), stay where they were built when borders move, and upgrade as a whole (levels
I–III). The zone-modifier hook, HUD odds, frame deltas and wall rendering of D-022 are
reused; the post, its zone and the friend matrix are dropped.

**Trade-off accepted.** Borders move every second, so a wall right on the border breaks at
the first push; walls built a few tiles inside your land are the strong play — a second
line, like Clash of Clans' inner walls. D-022's concern (painted segments go stale) is
answered by that: a wall is a fixed object on your land, not a property of the border.

---

## D-025 — Islands always; boats land as beachheads · Accepted 2026-10-02

**Context.** Milestone 2.7 adds boats, but the generated map kept only its largest
landmass (D-009, "no boats yet"), so boats could only cut across bays. Asked how boats
should get something to cross — a map choice (continent or islands), islands always, or
one continent until real maps (2.8) — **the user chose islands always**.

**Decision.** Every generated map is a continent plus 5–7 islands (§3.2): the islands are
their own layer, held to ~8% of the map and at least 18 tiles of open sea from the
continent; total land drops from 55% to 50%. `generateContinent({ islands: false })` still
makes the old map, byte for byte (a golden test pins it), so `--continent --no-boats`
headless runs reproduce 2.6 exactly. Boats (GAME_DESIGN §3.18): launched from any coast,
no Port needed; the route is a deterministic A* over sea tiles found once at launch; troops
aboard count toward the cap; on arrival they land as a **beachhead attack** — it takes the
landing tile and spreads from it, never merging with the land army, and its pocket can't be
encircled while it advances (built generically, for airborne assaults in 2B). Recall turns
a boat back. Port I–II: faster boats from its stretch of coast, more boats at sea, harbour
income, Marines (cheaper landings) at level II.

**Consequences.** Balance numbers from before 2.7 are no longer directly comparable (a
different map with less land); 2.7's report gives both. Clicking land you can't reach over
your border — another landmass, or a player you don't border — sends a boat (OpenFront
does the same).

**Alternatives.** A map choice on the start screen (my recommendation: keeps the old map
for comparison); one continent until real maps arrive in 2.8 (boats would barely matter).

---

## D-026 — Trade ships now; warship piracy in 2B.6; real-world maps parked · Accepted 2026-10-06

**Context.** At the start of 2.8 (more maps) the user, asked how boats feel: boats and
routes feel good, *"but we need ports to bring in income. Little ships should be around the
map that is considered trade and go to other nations and players ports. These ships will
eventually be able to be captured for income by warships. Allies are immune to warships,
all other trade is intercepted. Exactly how OpenFront is."* Asked where real-world maps
should come from (our own pipeline from public-domain NOAA elevation data — my
recommendation — or OpenFront's CC BY-SA maps), the user answered **"No real maps yet"**,
while picking World, Europe, North America and East Asia, with real country names for the
nations, for when they come.

**Decision.**
- **Trade ships** are built first in 2.8 (they extend 2.7's boats and Ports directly):
  every Port sends ships to other players' Ports on its sea; both owners earn gold on
  docking, more for longer routes (GAME_DESIGN §3.19). Ports' flat harbour income drops
  (+15/+40 → +5/+15 gold per tick) since trade is now where their money comes from.
  No embargo for now.
- **Warships capturing trade ships** (non-allied ships only; allies' and teammates' ships
  immune) belong with warships in **2B.6** (Port III Naval Base); the warship patrol there
  is no longer "only if boats prove fun" — the user confirmed they are.
- **Real-world maps are parked** (ROADMAP "Parked"), with the user's picks recorded; the data
  source is decided when they are scheduled. 2.8 keeps bigger and more varied generated maps,
  `WorkerHost` and the range re-check.

**Consequences.** Games with Ports have a second gold source (~20% of all gold in headless
games: ~190 trips per 8-nation game); game lengths stay about the same (8 nations 8.5 min
median, 2.7: 8.4; 10 nations + 100 tribes 12.7 min, 2.7: 13.4 — one earlier run had 15.0,
before the sea-route change; within the accepted 15–20 min target either way).

**Alternatives.** Trade ships as their own milestone after 2.8 (rejected: the user wants
Port income now and the code builds on 2.7's); keeping the flat harbour income on top
(rejected: Ports would out-earn Factories).

---

## D-027 — Alerts only; emojis + map pings · Accepted 2026-10-06

**Context.** Milestone 2.9 (sound & game events). Asked how much sound they want, the user
chose **"Alerts only"** (over effects for everything, effects + music, or no sound yet).
Asked how players talk, they chose **emojis + map pings** (over emojis only, or adding
quick-chat phrases). OpenFront's sounds are all-rights-reserved (D-001), so ours must be our
own.

**Decision.**
- Four alert sounds (as retuned the same day after the user played it: a subtle "attacked"
  sound once per attacker, the boat horn per enemy boat, alliance asks/renewals, any
  betrayal — pings and emojis are silent because they can be spammed),
  **synthesized with Web Audio** at play time — no audio files to make, store or license.
  Volume + mute in the pause menu, remembered per browser.
- **Emojis** (14, by index — never text) to a player or to everyone, shown over the sender's
  land; **map pings** (attack / defend / watch) seen only by the pinger's allies and
  teammates. Both are simulation commands (cooldowns validated there), so they need no
  rework for multiplayer.
- **Nations use them**: they act on friends' attack/defend pings, ping their human friends,
  and answer people's emojis. Only interactions with people trigger this, so bots-only
  games are unchanged.
- The **incoming-threat warning** is one client list (`threats.ts`) that chips, map markers,
  edge arrows and the boat horn all read; 2B adds flights and missiles to it.

**Consequences.** No game-length change (headless games identical to 2.8). Fuller sound
design (effects, music) stays in Phase 4 polish. 344 tests.

**Alternatives.** Effects for every action (rejected by the user for now); recorded sound
files (licensing and size; synthesis is enough for alerts); pings visible to everyone
(gives enemies the plan); quick-chat phrases (more UI, and bots would need to answer them).

---

## D-028 — The user's icon pack is the building and vehicle art · Accepted 2026-10-06

**Context.** During milestone 2B.0 the user added `openborder_icon_pack_final/` to the
project and asked that these icons be the game's icons for buildings and vehicles. The pack:
24 painted isometric PNGs (the SVGs only wrap the same PNGs) — buildings Housing, Factory,
Port, Airport and vehicles airplanes, helicopters, troop boats ("attack boats with troops"),
trade ships — each in three eras: **level 1 WW1, level 2 WW2, level 3 Modern**. Today's
icons are our own SVG drawings (`client/icons.ts`, 2.5 playtest revamp).

**Decision.** The eras become our levels I–III, and the pack replaces our drawings
wherever it has art. **Placement (mine; the user asked me to choose):** a milestone of its
own, **2B.0b**, right after 2B.0 flights and before 2B.1 Airport I — the Airport and the
planes then arrive with their real art, and every existing building and ship switches over in
one focused pass instead of being mixed into a gameplay milestone. Details:

- **Clean-up:** several PNGs still have the "LEVEL n / ERA" caption baked in (seen: Housing I,
  Factory III, Airport III, troop boat I — the README says they were removed); crop them,
  trim padding, and downscale to the sizes we draw (the folder is 2.9 MB).
- **Map:** the sprite sits on a ring in the owner's colour with the gold level pips (owner
  and level must stay readable — the art itself has no player colour); far zoom keeps the
  small dots (2.6 fix). **HUD:** build bar tiles and building cards show the sprite.
- **Vehicles:** troop boats and trade ships by the level of the Port they sail from (no
  Port: level 1); flights by the level of their Airport (test flights: level 1);
  helicopters for airborne assaults (2B.3). Sprites are isometric, so they are mirrored
  left/right by heading instead of rotated.
- **No art yet** for SAM, Missile Silo, walls, warships and missiles: our drawings stay
  until the user provides more icons in the same style (ask when each arrives).

**To confirm with the user before the art is committed/pushed:** where the sprite sheet
came from (D-001: nothing from OpenFront — the README calls the pack "OpenFront-style"); and
whether the planes' real national markings (a French roundel, US stars) are wanted.

**Answered 2026-10-06 (start of 2B.0b):** the user made/generated the pack themselves — it
may be committed (the PNGs are kept as the source art; the duplicate SVGs are git-ignored).
Markings: **remove them** (done by `tools/iconPack.mjs`). Missing art: the user wants **me to
make SAM, Missile Silo, wall, warship and missile art copying the same style**, each with
the milestone that adds or reworks the thing (SAM + walls 2B.2, Silo + missiles 2B.5,
warships 2B.6). Open: how — options are 3D models rendered isometrically in Blender (the
Blender bridge is installed but Blender was not running), or prompts I write for the same
image tool the user made the pack with (closest match to the style); to settle with the
user before 2B.2. **Settled during 2B.1:** the user sent a second sheet in the same style
(SAM I–III, walls I–III, Missile Silo I–III, missiles I–III plus cruise, air-to-air,
air-to-ground and ICBM), kept as `openborder_icon_pack_final/sheets/` and cut into sprites
by `tools/iconPack.mjs` (taken to be the user's own work, like the first pack). Walls use
their art in the HUD (on the map they stay drawn lines); SAM, Silo and missiles use theirs
when those features land (2B.2, 2B.5). Still without art: warships (2B.6) — ask the user.

**Alternatives.** Phase 4 polish (the art would wait months, and 2B would build Airport
and plane drawings only to replace them); inside 2B.1 (mixes an art pass into a gameplay
milestone, harder to judge either).

## D-029 — Landed armies don't collide with counter-attacks · Accepted 2026-10-12

**Context.** Playtesting 2B.4, the user landed an airborne army with more troops than the
enemy and was "swallowed": as soon as the enemy attacked them anywhere, all progress cleared at
once. Cause: the collision rule (§3.6) cancels every pair of opposite attacks between two
players, wherever they are; a nation's counter (1.3× the incoming army) wiped the landed army
out in one tick, and its pocket — no longer protected — was annexed by encirclement. Boat
landings had the same flaw. The user: "it should at least let you fight".

**Decision.** Beachhead attacks (airborne assaults and boat landings) never collide. Land armies
still cancel out as before. To remove a landing, the defender must take its pocket tile by tile
(normal attack costs) while the landed army keeps advancing; once it stops, the pocket can be
encircled as before. Nations aim their counter-attack at the landing pocket.

**Effect** (headless): landed airborne armies take ~3,600 tiles a game on Islands instead of
~1,350; Islands median 23.0 min (22.0), Continent 8.6 (8.8), Two lands teams 5.4 (6.4).

**Alternatives.** Keep collisions but only near the pocket (attacks target players, not places —
much more state); let the landed army's troops defend the pocket (a second defence model).

