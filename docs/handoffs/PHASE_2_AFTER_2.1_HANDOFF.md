# Phase 2 handoff (after milestone 2.1)

> **The game is now called OpenBorder** (D-014, 2026-10-02; older docs say "Borderline").
> The dev debug hook is `window.__openborder` (older handoffs say `__borderline`).

> **For the next session: read this file first**, then
> [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md) §4–§6 (how the user wants us to work,
> environment gotchas, repo map — all still valid). Written 2026-10-02. Last commit:
> `64996a5` "Phase 2.1: Tribes & Nations".

## 1. Where we are

| | |
|---|---|
| Phase 1 | ✅ tag `phase-1` |
| Phase 2 done | **2.0 big lobbies** (`27574a2`) · **2.1 Tribes & Nations** (`64996a5`) |
| Next | ⬜ **2.2 alliances**, then 2.3 teams (D-016) |
| Tests | 163 passing, type check clean, Prettier clean, `npm run build` OK |
| Balance (10 nations + 100 tribes) | nations win 150/150; median Hard 9.7 · Medium 12.6 · Easy 16.7 min |
| Lobbies without tribes | bit-identical to Phase 1 (8 nations: median 7.1 min, same as `phase-1`) |

## 2. What 2.0 and 2.1 added (details: ROADMAP results, GAME_DESIGN §3.12–3.13)

- **Start screen:** Nations 0–25 (default 7), Tribes 0–125 (quick picks 0/25/50/100,
  default 25), difficulty Easy/Medium/Hard (default Medium), map **Normal / Large**
  (1560×990, ~2× land), "N opponents · ≈ X tiles each". Choices live in `ui` and persist
  across games in a session.
- **Tribes (D-017 — the user chose weaker tribes):** `rules.tribe`: ⅓ capacity, ½ growth,
  non-tribes pay 0.7× losses per tribe tile; AI thinks every 4–8 s, expands, else attacks a
  random neighbour it can beat with 30% of its troops; never counters/reinforces/retreats.
  Colours: dull browns/tans (user request "like OpenFront"); small, light labels (troops
  only when zoomed in); spawns scattered at random (9 tiles apart, 20 from nations) while
  nations stay evenly spread — all from the user's first 2.1 playtest.
- **Nations:** the Phase 1 personality bots + `ai.difficulties` (think 6–10 / 4–7 / 2–5 s;
  Easy never counters or reinforces, Medium counters only, Hard both) — no stat changes
  (D-012). They weigh tribe targets 3× and run up to 3 tribe wars at once (one war at a
  time against a nation). Invented country names.
- **Spawns** spaced by lobby size (`randomSpacingShare`); **126 colours** (OKLab
  farthest-first); toasts for others' eliminations only if they bordered you (> 16 players).
- **Headless:** `--bots` = nations, `--tribes`, `--difficulty`, `--width/--height`;
  reports per-system tick time (`systemsMs`, slowest tick's steps) and wins by tier.
  `runTick(world, turn, probe?)` is the timing hook (the sim never reads a clock).

## 3. Known issues / open items

| Item | Where it goes |
|---|---|
| Large map: p99 ~10.5 ms, single ticks ~20 ms (encirclement floods of 500k-tile empires) | 2.7 with `WorkerHost` + cheaper encirclement (ARCHITECTURE §11) |
| Nations wipe each other out early (a nation that spends its pool is crushed in seconds; tribes then absorb the scraps) — accepted as the core game; revisit if play feels too swingy | playtest |
| Tribes and nations don't know about alliances yet | 2.2 |
| The user hasn't played 2.0/2.1 yet — ask for a playtest at the start of 2.2 or after it | — |

## 4. Next steps — milestone 2.2 alliances (ROADMAP row 2.2)

1. **Design note first** (GAME_DESIGN new §3.14), from OPENFRONT_RESEARCH §3.19 (ideas
   only): request → accept/decline; requests expire after 20 s; 30 s before asking the
   same player again; alliances last 5 min, both asked to renew in the last 30 s; allies
   can't attack each other (running attacks pull back free); breaking one = **traitor**
   for 30 s (attackers lose less and move faster against you). Decide: how many alliances
   at once, whether allies' land counts toward each other's win (probably not — teams do
   that in 2.3), what "traitor" changes in numbers.
2. **Simulation:** commands `allianceRequest`, `allianceReply`, `allianceBreak` (+ renew);
   alliance state in `World` (hashed); validation in `applyCommand`; attack validation
   rejects attacking allies; events for toasts.
3. **AI:** tribes accept every request and renewal and attack traitors (research §3.21);
   nations decide by threat / relative strength / shared enemies, renew if useful, betray
   when profitable (Hard more calculating, Easy more random).
4. **HUD:** right-click menu entries (Request / Break alliance), request toasts with
   Accept / Decline, renewal prompt, ally markers on the map (border tint?) and
   leaderboard, hover card "Ally (3:12 left)", traitor marker.
5. **Verify:** tests per rule (ASCII maps), headless metrics (do alliances lengthen games?
   do nations betray believably?), every flow in the browser. Commit "Phase 2.2: alliances".

## 5. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2_AFTER_2.1_HANDOFF.md`, then the docs it lists, and continue
> Phase 2 with milestone 2.2 (alliances). Follow the working agreements in the Phase 1
> handoff.
