# Phase 2 handoff (after milestone 2.9)

> **For the next session: read this file first**, then
> [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md) §4–§6 (how the user wants us to work,
> environment gotchas, repo map — all still valid; the debug hook is
> `window.__openborder`). Written 2026-10-06. Last code commit: "Phase 2.9: alert sounds,
> incoming-threat warning, map pings, emojis (D-027)".

## 1. Where we are

| | |
|---|---|
| Phase 1 | ✅ tag `phase-1` |
| Phase 2 done | 2.0 big lobbies · 2.1 Tribes & Nations · 2.2 alliances · 2.3 teams · 2.4 economy · 2.5 buildings · 2.6 walls · 2.7 islands, boats, Ports · 2.8 trade ships, map types, WorkerHost · **2.9 alerts, pings, emojis** |
| Next | ⬜ **2.10 Phase 2 playtest & balance** (ROADMAP row 2.10) — then the **Phase 2 handoff** |
| Then | **Phase 2B air & strategic warfare (before multiplayer, bots first)** · Phase 3 multiplayer |
| Parked | Real-world maps (D-026) — ask the user when to schedule |
| Tests | 346 passing, type check clean, Prettier clean, `npm run build` OK |
| Regression | Bots-only games are **identical to 2.8** (18/18 headless games compared seed by seed against a worktree of the 2.8 commit) |

GitHub: `origin` = https://github.com/worstpart/OpenBorders.git (branch `main`). After every
handoff: commit, push, confirm `main` = `origin/main` to the user.

## 2. What happened in 2.9

1. Asked the user first: **trade ships and new maps "feel good, move on"**; sound →
   **"Alerts only"**; talking → **emojis + map pings** (no quick chat). → D-027.
2. Built sim (`systems/chat.ts`, `ai/chat.ts`), client (`audio/sound.ts`, `app/threats.ts`,
   `app/chat.ts`, `render/markers.ts`, menus), tests (+28), docs (GAME_DESIGN §3.20,
   D-027, ROADMAP 2.9 result, ARCHITECTURE §6).
3. Browser-checked in my own tab (dev server `dev`, port 5173): every alert fired (via the
   new `__openborder.sound()` log — the pane can't be heard), emoji grid + nation reply
   (sent 💀, Grenholm answered 😂), pings from the menu and **G**, "no friends" toast, red
   threat ring + countdown + chip, edge arrow for an off-screen boat, mute/volume saved.
   Fixed what it showed: edge arrows now stay clear of the command bar and top chips.

**After the handoff, same day:** the user hit a dead start screen (Huge → Islands) because
I had stopped the dev server while they were in that tab → map generation now falls back to
the main thread if its worker fails (`76e9a95`). Then the user found the attack and ping
sounds constant and spammable → retuned (GAME_DESIGN §3.20): subtle "attacked" sound once
per attacker (30 s quiet), **boat horn kept** at the user's request (once per enemy boat),
alliance requests ring, **every betrayal sounds and toasts for everyone**; pings and emojis
silent. Logic in `client/app/alerts.ts` (`AlertPlanner`). Lesson: **don't stop the dev
server at the end of a turn** — the user keeps playing in that tab.

## 3. As built (details: GAME_DESIGN §3.20, ARCHITECTURE §6 "Alerts, pings & emojis")

- **Sim:** commands `emote {to (0 = everyone), emoji index}` and `ping {tile, kind:
  attack|defend|watch}`; `rules.chat` (emoji list, cooldowns 3 s / 1 s, ping 10 s, 3 per
  player, nation preferences ×3, nation ping cooldown 30 s, help threshold 60%, reply
  chance 60%); `world.pings` (+ `Player.lastEmoteTick/lastPingTick`, hashed); events
  `emoted`, `pinged`; frames carry `pings`.
- **Nations (`ai/chat.ts`):** friends' attack pings → preferred target aimed at the ping;
  defend pings → that friend's attackers preferred; they ping human friends where they
  strike (not tribes) or when overrun; they answer people's emojis and react to betrayal /
  alliance / attack. Only with people involved → headless unchanged.
- **Client:** `threats.ts` (the reusable incoming list — add 2B flights/missiles there),
  `chat.ts` (who sees what, G's ping kind), `markers.ts` (rings, edge arrows, emoji
  bubbles), `sound.ts` (4 synthesized alerts, throttled, volume/mute in localStorage),
  right-click menu rows "Ping for your allies" + emoji grid, pause menu "Alert sounds",
  key **G**, toasts for emojis to you and friends' pings.

## 4. Known issues / open items

| Item | Where it goes |
|---|---|
| **Ask the user to playtest 2.9**: alert sounds (loudness, are they annoying?), pings with nation teammates in a Teams game, emojis — and then the whole of Phase 2 together | start of 2.10 |
| Islands games are long (20.5 min median, 8 nations) | 2.10 balance |
| Nations build only one Port; no embargo; settle islands only when no open land touches them | 2.10 / later if asked |
| Nation pings to humans are unit-tested; not yet seen in a long browser game | 2.10 playtest |
| Edge arrows on the right can sit under the leaderboard (collapsible) | fine; revisit in Phase 4 polish |
| Fuller sound (effects, music) | Phase 4 polish (D-027) |
| From earlier: spatial grid for buildings; no gold column on the leaderboard; EndCard team path; Renew-click glitch; first trade routes on Huge ~40 ms | see earlier handoffs |
| Shell gotchas (still true): long inline scripts with backticks/quotes fail — write them to the scratchpad and run `node file.cjs < /dev/null`; `cat > file` with no heredoc hangs | — |
| Ports: this time 5173 (`dev`) was free; 5178 and 5181 were held by other chats. Another chat's dev server watches this folder, so edits hot-reload there too | — |

## 5. Next steps — milestone 2.10 (ROADMAP row 2.10)

Phase 2 playtest & balance: ask the user to play buildings, walls, boats, trade and the
2.9 alerts together (suggest one Teams game on Islands or Two lands with nations on their
team, and one big free-for-all); collect what feels off; tune with headless runs
(`npm run headless`, and the seed-by-seed worktree comparison used in 2.9 when a change
must not alter bots-only games); check the game-length target (15–20 min accepted,
§3.17.12; Islands at 20.5 min is the outlier). When the user approves the feel, write
`docs/handoffs/PHASE_2_HANDOFF.md` (end of Phase 2) and tag `phase-2`.

## 6. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2_AFTER_2.9_HANDOFF.md`, then the docs it lists, and continue
> Phase 2 with milestone 2.10 (Phase 2 playtest & balance). Follow the working agreements
> in the Phase 1 handoff.
