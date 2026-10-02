# Phase 2 handoff (after milestone 2.3)

> **For the next session: read this file first**, then
> [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md) §4–§6 (how the user wants us to work,
> environment gotchas, repo map — all still valid; the debug hook is now
> `window.__openborder`). Written 2026-10-02. Last commit: "Phase 2.3: teams".

## 1. Where we are

| | |
|---|---|
| Phase 1 | ✅ tag `phase-1` |
| Phase 2 done | **2.0 big lobbies** · **2.1 Tribes & Nations** · **2.2 alliances** · **2.3 teams** |
| Next | ⬜ **2.4 economy** (gold, model E2 + Mobilize prototype, GAME_DESIGN §6.1; donations between allies/teammates) |
| Tests | 215 passing, type check clean, Prettier clean, `npm run build` OK |
| Balance | see ROADMAP "Milestone 2.3 result" |
| Regression | free-for-all games are identical to 2.2 (8-nation headless run: same median, same wins) |

## 2. What 2.3 added (details: GAME_DESIGN §3.15, D-019, ARCHITECTURE §5.3)

- **User's answers (D-019):** alliances work exactly as in free-for-all — always requested,
  across teams too; allied teams never win together; tribes have no team (ally them early
  for safe land); nations spawn at random and humans pick their own spot (no team
  regions); teams are how friends will queue together in Phase 3.
- **Rules:** 2–8 teams; you and the nations dealt round-robin (you on team 1). Teammates
  can't attack or encircle each other (`areFriendly` = same team or allied) and can't be
  asked for an alliance. A team wins with 70% combined land (same anti-stall decline) or
  when it's the last side with a nation/human left — leftover tribes don't block it.
  Nations count teams as the "contenders" for the "never ally when two are left" rule, so
  in 2-team games they never ally across teams.
- **AI:** nations skip teammates, prefer enemies attacking a teammate (×2) and enemies a
  teammate already attacks (×1.5).
- **HUD:** start screen *Mode* + *Teams* stepper + split line; team colours (team hue,
  member shades; you keep the blue); leaderboard *Teams* block, *team* tags; teammates in
  mint (names, borders); "Teammate · Team Blue" hover card and menu; team name on others;
  you-chip shows your team; toasts for a teammate's elimination and a team knocked out;
  team end card ("Team Red won the match" / "Your team…", also if you were knocked out).
- **Tools:** headless `--teams N` reports wins by team, last-team-standing wins and
  teammate attacks (always 0).

## 3. Known issues / open items

| Item | Where it goes |
|---|---|
| 2-team games are short (4v4 nations: median 4.7 min; with 100 tribes 7.3) and the team ahead at minute 3 wins ~75%. Gang-up weights off or an 80% goal didn't fix it | playtest; possible fixes: team spawn regions (user said no for now), a team goal that scales with team count |
| In 2-team games nations never ally across teams (two sides left) — consistent with §3.14, but the user said "alliances same as FFA". Easy to change (`contenders()` in bot.ts) if they want cross-team pacts with only two teams | ask after playtest |
| EndCard "your team won" path is unit-logic only; in the browser I saw the "Team Red won" path | next browser session |
| Turtles win often with alliances on (2.2) | playtest |
| One unconfirmed 2.2 glitch: a mouse click on a renewal card's *Renew* once didn't register | next browser session with the pane visible |
| Large map perf (encirclement floods) | 2.7 with `WorkerHost` |
| **The user hasn't playtested 2.0–2.3 yet** (said "carry on" at the start of 2.3) — ask at the start of 2.4 | — |

## 4. Next steps — milestone 2.4 economy (ROADMAP row 2.4)

1. Design note (GAME_DESIGN §6.1 → a new §3.16): gold income (model E2), what gold buys
   before buildings exist (Mobilize prototype), donations of troops/gold between allies and
   teammates (with cooldowns), how tribes and nations use gold. Ask the user only on
   decisions that change the game (e.g. whether troops can be donated at all).
2. HUD: gold in the command bar, donate actions in the right-click menu.
3. Headless metrics: gold curves, game length vs 2.3; FFA regression with the economy off.
4. Commit "Phase 2.4: economy".

## 5. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2_AFTER_2.3_HANDOFF.md`, then the docs it lists, and continue
> Phase 2 with milestone 2.4 (economy). Follow the working agreements in the Phase 1 handoff.
