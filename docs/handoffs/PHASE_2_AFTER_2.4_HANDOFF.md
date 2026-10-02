# Phase 2 handoff (after milestone 2.4)

> **For the next session: read this file first**, then
> [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md) §4–§6 (how the user wants us to work,
> environment gotchas, repo map — all still valid; the debug hook is
> `window.__openborder`). Written 2026-10-02. Last commit: "Phase 2.4: economy".

## 1. Where we are

| | |
|---|---|
| Phase 1 | ✅ tag `phase-1` |
| Phase 2 done | **2.0 big lobbies** · **2.1 Tribes & Nations** · **2.2 alliances** · **2.3 teams** · **2.4 economy** |
| Next | ⬜ **2.5 buildings** (City, Fort, Port, + Market if needed — GAME_DESIGN §6.2); they spend the 2.4 gold |
| Tests | 237 passing, type check clean, Prettier clean, `npm run build` OK |
| Balance | see ROADMAP "Milestone 2.4 result" |
| Regression | `--no-economy` games are identical to 2.3 (8-nation run: same median, same wins) |
| Playtest | the user playtested 2.0–2.3 at the start of 2.4: "playtest went well" |

## 2. What 2.4 added (details: GAME_DESIGN §3.16, D-020, ARCHITECTURE §5.3)

- **User's answers (D-020):** troops can be donated as well as gold (with limits); during
  the milestone: conquering a nation or tribe gives **all** of its leftover gold, with an
  animation on the border.
- **Rules:** income 10 + 0.8·√tiles gold per tick (tribes half, never spent → loot);
  `mobilize` command (1 gold per troop, never past the cap); `donate` command (troops
  capped by the friend's room, or gold; allies and teammates; 10 s per friend and kind);
  loot = all of the eliminated player's gold (`eliminated` event carries `loot`).
- **AI:** nations keep gold as a war chest and mobilize it right before attacking a
  player; they give troops to a teammate/human ally losing a war and spare gold (at the
  cap) to the one with the emptiest army — never to allied nations (that stalled wars).
- **HUD:** gold row + Mobilize button (key M, +10% of capacity per click) in the command
  bar; *Send troops / Send gold* in an ally's or teammate's right-click menu (uses the send
  %, shows cooldowns and "their army is full"); gold on the hover card; gift and loot
  toasts; a "gold" hint; the capture effect (capturer's border shimmers gold, a gold
  grow-in, "+gold" with a coin rising from the captured land) — strength in palette alpha
  bits 2–7, updated per animation frame.
- **Tools:** headless `--no-economy`; per game gold earned/mobilized/gifts/loot and the
  median nation income at minutes 1, 3, 6.

## 3. Known issues / open items

| Item | Where it goes |
|---|---|
| Turtles win ~half of tribe-lobby games (24/50; 2.2: 20/50) | playtest / 2.5 (Forts may help attackers' targets differ) |
| 2-team games: the team ahead at minute 3 wins 62–75% | playtest; options in the 2.3 handoff |
| No gold column on the leaderboard (gold is on the hover card) | add if the playtest asks |
| Nations don't give to allied *nations* (by design, see §3.16) — only teammates and human allies | revisit if alliances feel hollow |
| EndCard "your team won" path is unit-logic only | next browser session |
| One unconfirmed 2.2 glitch: a click on a renewal card's *Renew* once didn't register | next browser session |
| Large map perf (encirclement floods) | 2.7 with `WorkerHost` |
| **Ask the user to playtest 2.4** (gold, Mobilize, gifts, loot animation) at the start of 2.5 | — |

## 4. Next steps — milestone 2.5 buildings (ROADMAP row 2.5)

1. Design note (GAME_DESIGN §6.2 → a new §3.17): City (+capacity), Fort (defensive zone),
   Port (naval access/trade — maybe only a placeholder until 2.6 boats; avoid fake
   systems), Market only if gold needs another source. Costs in gold, placement rules,
   capture/destruction, how nations and tribes use them, how buildings compete with the
   war chest. Ask the user only on decisions that change the game.
2. Rendering of structures on the map; build menu/hotbar in the HUD.
3. Headless metrics: game length vs 2.4, buildings per game; regression with buildings off.
4. Commit "Phase 2.5: buildings".

## 5. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2_AFTER_2.4_HANDOFF.md`, then the docs it lists, and continue
> Phase 2 with milestone 2.5 (buildings). Follow the working agreements in the Phase 1 handoff.
