# Phase 2 handoff (after milestone 2.2)

> **For the next session: read this file first**, then
> [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md) §4–§6 (how the user wants us to work,
> environment gotchas, repo map — all still valid; the debug hook is now
> `window.__openborder`). Written 2026-10-02. Last commit: "Phase 2.2: alliances".

## 1. Where we are

| | |
|---|---|
| Phase 1 | ✅ tag `phase-1` |
| Phase 2 done | **2.0 big lobbies** · **2.1 Tribes & Nations** · **2.2 alliances** |
| Next | ⬜ **2.3 teams mode** (D-016), then 2.4 economy |
| Tests | 193 passing, type check clean, Prettier clean, `npm run build` OK |
| Balance | see ROADMAP "Milestone 2.2 result" (headless, alliances on vs off) |
| Regression | `--no-alliances` (or `rules.diplomacy.enabled = false`) reproduces 2.1 games exactly |

## 2. What 2.2 added (details: GAME_DESIGN §3.14, D-018, ARCHITECTURE §5.3)

- **Rules:** request → accept/decline (20 s expiry, 30 s before asking the same player
  again; asking someone who asked you accepts). Alliances last 5 min; both are asked in
  the last 30 s and it's extended only if both renew. Allies can't attack each other;
  armies already fighting between them come home without the retreat loss; allies never
  encircle each other. Breaking = **traitor for 30 s** (attackers pay 0.6× losses, 0.75×
  delay). Only your own land counts for victory. No cap on alliances.
- **AI:** tribes accept and renew everything, attack neighbouring traitors first. Nations
  never ally tribes; decide by threat (appeasement of a stronger neighbour), shared
  enemies, a safe flank while at war; refuse traitors, grudges (5 min), runaway leaders
  (≥ 25% land), anyone at 2 alliances or with only 2 contenders left, or a player they're
  beating. They ask one bordering player per think (each at most every 90 s), renew if
  they'd still accept, and betray an ally they can (nearly) wipe out — whether they're
  the kind to betray is decided once per alliance from difficulty × personality (turtles
  never). **User request during 2.2:** nations weigh traitors 2× as targets
  (`ai.traitorPreference`).
- **HUD:** right-click menu (Request / Accept / Renew / Break with a second click),
  **K** = ally with the hovered player, **Y / N** = answer the top card; diplomacy cards
  (left, under the you-chip) for requests and renewals with countdown bars; toasts;
  mint ally borders and names; coral moving stripes + coral name on traitors; leaderboard
  `ally` / `traitor` tags; hover card badges; odds include the traitor discount; a new
  timed hint about alliances; pause-menu controls list.
- **Tools:** headless `--no-alliances` and per-game diplomacy stats (requests, declined,
  formed, nation alliances, renewed, expired, betrayals). Dev hook
  `__openborder.sendAs(playerId, command)` sends a command as another player (e.g. make
  a bot ask you for an alliance) — `LocalHost.sendAs`, solo/dev only.
- `.claude/launch.json` gained **`dev-5` (port 5177)** — other chats held 5173–5176.

## 3. Known issues / open items

| Item | Where it goes |
|---|---|
| Turtles win more often with alliances on (they accept readily and never betray) — believable, but watch it | playtest / 2.3 tuning |
| Most requests between nations are declined (~75%): nations mostly ask stronger neighbours, who usually say no | fine for now; revisit if the user finds nations unfriendly |
| Svelte card/toast transitions use rAF: in a **hidden** browser pane outgoing cards linger in the DOM (scripted checks read them). Not visible to players | — |
| One unconfirmed glitch: a mouse click on a renewal card's *Renew* right after another card was dismissed didn't register once (DOM clicks always worked; Accept/Decline/Let-it-end clicks worked). Re-check with the pane visible | next browser session |
| Large map perf (encirclement floods) | 2.7 with `WorkerHost` |
| The user hasn't playtested 2.0–2.2 yet — ask at the start of 2.3 | — |

## 4. Next steps — milestone 2.3 teams (ROADMAP row 2.3)

1. Design note (GAME_DESIGN §3.15): 2–N teams of humans + bots, team colours (shades
   per team?), shared victory on combined land, no attacking teammates (reuse the
   alliance checks: a permanent, unbreakable "alliance" between teammates is the
   simplest model — consider `isAllied` → `areFriendly`), team-aware AI (help teammates,
   gang up on a common target), how tribes fit (probably neutral filler, no team).
2. Start screen: mode FFA / Teams, team count; leaderboard by team.
3. Victory: team land share; anti-stall for teams.
4. Verify with headless (`--teams N`) and in the browser. Commit "Phase 2.3: teams".

## 5. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2_AFTER_2.2_HANDOFF.md`, then the docs it lists, and continue
> Phase 2 with milestone 2.3 (teams). Follow the working agreements in the Phase 1 handoff.
