# Phase 2B handoff — after milestone 2B.0 (flight foundation)

> **For the next session: read this file first.** It updates
> [`PHASE_2_HANDOFF.md`](PHASE_2_HANDOFF.md), whose **§4 working agreements, §5 environment
> facts and §6 repository map still apply** — read those sections too. Written 2026-10-06.
> The repo docs are the source of truth, not chat history.

---

## 1. Where we are

| | |
|---|---|
| Phase 2 | ✅ tag `phase-2` |
| **2B.0 flight foundation** | ✅ commit "Phase 2B.0: flight foundation" (ROADMAP "Milestone 2B.0 result") |
| **Next** | ⬜ **2B.0b — Icon pack art** (D-028, the user's request during 2B.0), then 2B.1 Airport I + airlift |
| Tests | 365 passing, type check clean, Prettier clean, build OK |
| Regression | 18 bots-only games identical to `phase-2`, **every tick's hash** (`tools/hashDigest.mjs`) |

**What 2B.0 added:** `world.flights` (straight-line flights, positions a pure function of
the tick), launch / arrival / interception / loss events, flights in frames and the hash
(only once a game has had one), troops aboard as field troops, `shootDown`, building charges
(reload one at a time) and mission cooldowns. Client: aircraft glyph + "×planes", dotted
route and ETA, hostile flights in the incoming-threat list (chip, red ring + countdown, edge
arrow, toast, the horn once per sender per 30 s). No nation flies yet — there is nothing to
fly from before Airports (2B.1). Flights are launched with the **debug `testFlight`
command**, accepted only in dev builds:

```js
const ob = window.__openborder;          // dev builds only
const own = ob.owner();                   // who owns each tile (new in 2B.0)
ob.send({ type: "testFlight", from: myTile, to: anyTile });
ob.sendAs(botId, { type: "testFlight", from: botTile, to: myTile }); // an incoming one
```

## 2. The user's request during 2B.0 — the icon pack (D-028)

The user put **`openborder_icon_pack_final/`** in the project root (untracked, and
git-ignored until its provenance is confirmed) and asked that these icons become the game's
building and vehicle icons. I scheduled it as **milestone 2B.0b**, right after 2B.0 and before
2B.1, so the Airport and planes arrive with their real art. Full plan: ROADMAP 2B.0b row,
DECISIONS D-028, memory `project-icon-pack`.

The pack: 24 painted isometric PNGs (the SVGs only wrap the same PNGs) — buildings
`housing`, `factories`, `ports`, `airports`; vehicles `airplanes`, `helicopters`,
`attack_boats_with_troops`, `trade_ships` — each `level_1_ww1`, `level_2_ww2`,
`level_3_modern` (era = our level I–III). Found while looking:

| Finding | Plan |
|---|---|
| "LEVEL n / ERA" captions still baked into some PNGs (seen: housing L1, factories L3, airports L3, boats L1; README says removed) | Crop them (check all 24), trim padding, downscale to the sizes we draw (folder is 2.9 MB) |
| The art has no player colour | Sprite on a ring in the owner's colour + gold level pips; far zoom keeps the small dots |
| Isometric sprites don't rotate well | Mirror boats/planes left-right by heading |
| No art for SAM, Missile Silo, walls, warships, missiles | Keep our drawings (`client/icons.ts`); ask the user if they want more in this style |
| Planes carry real national markings (French roundel, US stars) | Ask the user: fine, or unmarked versions? |
| README calls it an "OpenFront-style" pack from a "user-selected sprite sheet" | **Ask where it came from before committing it** (D-001: nothing from OpenFront) |

Mapping: boats and trade ships by the level of the Port they sail from (no Port: level 1);
flights by their Airport's level (test flights: level 1); helicopters for airborne assaults
(2B.3). Build bar and building cards show the sprites too.

## 3. Start of the next session

1. **Ask the user** (one message, plain language): where the icon sheet came from (and
   that it must not be OpenFront's art); whether the planes' national markings are OK;
   whether they want SAM / Silo / warship / missile icons in the same style later. Also offer
   a quick look at test flights (they need the console — show a screenshot instead, or
   launch one in their game if they want). Working agreement: start each milestone by
   asking about the previous one — 2B.0 has no player-facing controls yet, so keep it short.
2. **2B.0b:** clean the sprites (no Python: script with `node`; for cropping, a small dev
   page using a canvas, or a dev dependency like `pngjs` — say which and why), put them in
   `src/client/assets/icons/`, load them once as images, draw them in `render/buildings.ts`
   and `render/boats.ts`/`render/flights.ts`, and in `BuildBar.svelte` / `BuildingCard.svelte`
   (`client/icons.ts` stays for SAM/Silo/walls). Check readability at every zoom, bundle size,
   fps (the perf overlay), then the user's approval of the look. Commit the art only after
   provenance is confirmed (remove the `.gitignore` line).
3. **2B.1 Airport I + airlift** (bots first): the Airport building (rules, placement on
   plains), the airlift mission using `launchFlight` / cooldown slot 0, arrival into the
   friend's home troops with overflow flying back, nation AI airlifting to a teammate losing
   a war, then the Airport card with its action and range ring (the "range rings in action
   mode" left over from 2B.0), headless metrics (flights per game).

## 4. Environment notes learned this session

| Fact | Detail |
|---|---|
| Hidden browser pane | Screenshots still work, but rAF stops, so the map canvas is stale and Svelte transitions never finish. For a check in **your own tab**: `window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 33)` keeps the render loop running; then screenshots show the live map. A full reload (any edit) undoes it |
| Hot reload | Editing client files fully reloads the page — restart the game (Play, click a spawn, `send({type:"confirmSpawn"})`) |
| `cat > file` with no heredoc | Hangs (it happened again); write files with the Write tool or a heredoc |
| Regression tool | `node tools/hashDigest.mjs <root> <continent|tribes|islands|twinTeams> 1,2,3` on this checkout and on `git worktree add <dir> phase-2` (or the previous commit); diff the outputs. ~2 min for 18 games with 8 processes in parallel |
| Dev server | This session used **`dev-4` (port 5176)** |

## 5. Suggested opening prompt for the new chat

> Read `docs/handoffs/PHASE_2B_AFTER_2B.0_HANDOFF.md` (and the sections of
> `PHASE_2_HANDOFF.md` it points to), then start milestone 2B.0b (icon pack art). Follow
> the working agreements.
