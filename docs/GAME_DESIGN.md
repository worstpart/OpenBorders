# Game Design

> **Status:** initial draft (Phase 0). Numbers are starting points to be tuned by
> playtesting and headless bot-vs-bot simulations. Anything marked **[Decision]**
> needs your input; see also `DECISIONS.md`.
>
> **Name:** *OpenBorder* (D-014, chosen by the user 2026-10-02; was the codename
> *Borderline*). Similarity to "OpenFront" is a known risk to revisit before launch.

---

## 1. Vision

A real-time territory strategy game in the browser. You start as a speck on a map and
grow into an empire by expanding, fighting and making (and breaking) alliances.

**"Easy to understand in 30 seconds, difficult to master."**

```
START SMALL → EXPAND → GROW → MEET NEIGHBORS → FORM BORDERS → FIGHT / ALLY → BUILD → CONTROL THE MAP → WIN
```

### Design pillars

1. **The map is the hero.** Most of the screen, most of the time, is the map. UI is
   small, contextual and translucent.
2. **One question, always:** *"Do I keep growing, or strike now?"* Every system should
   feed this tension rather than add a separate minigame.
3. **One click to act.** The primary action (attack/expand here) is a single click.
   Everything else is contextual.
4. **Readable at a glance.** Ownership, fronts, who's winning and how fast — all
   visible on the map without opening anything.
5. **Same rules for everyone.** AI uses the same actions and information as humans; no
   hidden bonuses.
6. **Depth from interactions, not from feature count.** A building or mechanic earns its
   place only if it creates new decisions.

---

## 2. The core loop (Phase 1)

| Moment | What the player does | What makes it interesting |
|---|---|---|
| Spawn | Click a starting spot | Distance to neighbors, terrain, coastline |
| Expand | Click neutral land to flow into it | Neutral land is cheap but not free; direction matters |
| Grow | Watch troops regenerate | Growth is fastest at **half capacity** → don't sit at max |
| Meet neighbors | Borders touch | Every shared border is a threat *and* an opportunity |
| Fight | Choose a % of troops and click enemy land | Bigger commitments are more efficient but leave you exposed |
| Encircle | Cut through, surround pockets | Fully enclosed land falls instantly |
| Win | Control 80% of the land (70% until D-033) or outlast everyone | |

---

## 3. Phase 1 rules (what we will build first)

All numbers live in one rules config (`GameRules`) — none are hard-coded in systems.

### 3.1 Time

- **10 simulation ticks per second** (100 ms). All rates below are per tick unless
  noted. Rendering runs at display rate with interpolation/animation.

### 3.2 Map

- One **procedurally generated fictional continent** (seeded, so everyone gets the same
  map from the same seed): plains, highlands, mountains, lakes, coast.
- Starting size ≈ **1100 × 700 tiles** (~770k tiles, ~55% land). Tuned so the land
  race lasts ~60–90 s with 8 players.
- Generation (implemented in milestone 1.1): domain-warped fractal noise minus a falloff
  toward the edges; sea level chosen so 55% of tiles are land; only the largest landmass
  is kept (no boats yet) and lakes under 80 tiles are filled; land is ~68% plains, 22%
  highland, 10% mountain, with mountains following ridge noise so they form chains.
- **Islands (milestone 2.7, D-025 — the user chose islands always):** the continent
  holds 42% of the map and 5–7 islands another ~8% (50% land in all). Islands are their
  own layer — each has a centre in the ring between the continent and the map edge and
  its own falloff — and rise only beyond **18 tiles of open sea** from the continent's
  coast; islets under 400 tiles are sunk. On the reference map: a continent of ~320k tiles
  and islands of ~1k–45k. `islands: false` still makes the old single continent exactly
  (regression runs).
- **Map types, sizes and a new map each game (milestone 2.8).** The start screen picks a
  type — **Continent** (the map above), **Islands** (an archipelago: the map cut into cells a
  third of its height wide, most holding an island, ~38% land, 11–15 islands of 13k–60k
  tiles on Normal) or **Two lands** (two continents of similar size across open sea, ~48%
  land, a few islets) — and a size: **Normal** 1100×700, **Large** 1560×990 (~2×), **Huge**
  2200×1400 (~4×, for 100+ players). "Map #N" names the map; **🎲 New map** rolls another
  seed (the classic map is #2). Landmasses on the two new types are kept apart by straits
  (14 tiles between islands, 22 between continents) cut wherever land of two centres meets,
  along a wandering line, so boats and trade always have water to cross. Maps are generated
  in a worker (Huge takes ~2.5 s) while the start screen says "Generating map…".
- Tiles are 4-connected (N/S/W/E) for ownership and combat.
- Terrain classes: **Plains** (fast, cheap), **Highland** (slower, costlier),
  **Mountain** (slowest, costliest), **Water** (impassable in Phase 1).

### 3.3 Players & spawning

- 1 human + **7 AI opponents** by default (configurable 1–125 since milestone 2.0, §3.12).
- **Spawn phase:** the human clicks any valid land to choose a start (can re-pick until
  confirming / the phase ends). AI spawns randomly, keeping a minimum distance from
  everyone else. Single-player starts the moment the human confirms.
- A spawn claims a small disc (radius 4 = 49 tiles): only **neutral land connected to the
  chosen tile** (a disc never jumps across water or takes someone else's land).
- Random spawns (bots, or players who didn't pick) need ≥ 80% of a full disc, and keep
  ≥ 70 tiles from other spawns when the map allows it — less in big lobbies (§3.12) —
  relaxed step by step on crowded maps.
- The human locks in their pick with *confirm*; in single-player the match starts at that
  moment. Troops don't grow during the spawn phase.
- **Spawn protection:** no player-vs-player attacks for the first **5 s**.

### 3.4 Troops

Each player has a **home pool** `T` (troops at home, defending) and may have troops
**in the field** `F` (inside active attacks). `L` = tiles owned.

```
Capacity          M = M_BASE + M_SCALE · L^0.6
Total cap         T + F may not grow beyond M
Growth per tick   g = G_FLOOR · (1 − x) + G_PEAK(M) · 4x(1 − x),   x = T / M
                  G_PEAK(M) = G_SCALE · M^0.75
                  growth is clamped so that T + F ≤ M
Starting troops   T₀ = 0.30 · M(spawn)
```

| Constant | Initial value | Why |
|---|---|---|
| `M_BASE` | 10,000 | Gives a usable cap at spawn |
| `M_SCALE` | 1,000 | Spawn (~50 tiles) → M ≈ 20,500 |
| capacity exponent | 0.6 | Sublinear: 2× land ≈ 1.5× capacity — land matters, snowball is damped |
| `G_FLOOR` | 10 | A player with almost no troops still recovers |
| `G_SCALE` | 0.044 | Early game: ~15 s from 10% to 50%, ~15 s from 50% to 90% |
| growth exponent | 0.75 | Big empires refill *proportionally* slower (~30 s at 10k tiles, ~40 s at 100k) |

**Design properties (these matter more than the exact numbers):**
- **Sweet spot at 50%.** The `4x(1−x)` shape peaks at half capacity. Players can learn
  one simple rule — *"troops grow fastest at half"* — and the troop bar will show it.
- **No growth at the cap.** Sitting at max is wasted potential.
- **Troops in the field count toward the cap.** Fixes the stockpiling exploit we found
  in OpenFront (troops parked in attacks or boats letting players exceed their max).
  Growth itself is still based on the home pool, so sending troops away from above the
  sweet spot still *increases* regeneration immediately — the cycle stays rewarding.
- **Real numbers.** What the HUD shows is what the simulation uses (no hidden ÷10).

### 3.5 Expanding into neutral land

Clicking neutral land you can reach launches an **expansion** with your current
attack percentage.

```
Cost per tile (troops)   plains 3 · highland 4 · mountain 6
Front speed              one tile per layer delay: 1.5 ticks on plains (~6 tiles/s with jitter)
                          × terrain (plains 1 · highland 1.7 · mountain 4)
                          ÷ min(1, army / 2,000)     ← tiny armies crawl (floor 10% speed)
```

A long frontier captures more tiles per tick only because more tiles are on the front;
the front itself never advances faster than its layer delay (see §3.7).

- Expansion is **directed** (§3.7): it flows outward from where you clicked first,
  then spreads.
- **Geography matters** (milestone 1.7, after the playtest: "land grabs feel long; grass
  should be fastest, mountains and snow slow"): measured with `tools/speeds.ts`, open
  land falls at ~6 tiles/s on grass, ~3.5 on highland and ~1.5 on mountains. Territories
  flow along green valleys and stop at ridges. With 8 bots, 90% of the land is owned
  after ~2.1 min (was 2.8; 3.1 before right-sized bot expansions). The random jitter per
  tile is now a share of the tile's delay (up to +67%), not a fixed time — a fixed time
  had flattened the terrain differences on fast fronts.
- Early on, regeneration outpaces expansion costs (a land race limited by speed and
  geography). As your frontier grows, expansion becomes troop-limited and *direction*
  becomes a real choice.

### 3.6 Attacking players

Left-click enemy land that touches your territory → an attack with
`troops = T × attack%`. Clicking again adds more troops to the same attack and moves
its focus point.

For each tile conquered (our model, adapted from the proven OpenFront structure with
our own constants):

```
r  = defender home pool ÷ attacking army          (how outnumbered the attack is)
d  = defender home pool ÷ defender tiles          (defender density)

attacker loss / tile = TERRAIN_LOSS × clamp(r, 0.5, 2.5) × (LOSS_BASE + LOSS_DENSITY × d)
defender loss / tile = d
layer delay (ticks)  = 4 × TERRAIN_SLOW × clamp(r < 1 ? r^1.3 : r, 0.05, 8)
                       (× r/20 more when r > 20: hopeless attacks barely move)

LOSS_BASE 3 · LOSS_DENSITY 1.2 · TERRAIN_LOSS 1 / 1.25 / 1.5 · TERRAIN_SLOW 1 / 1.5 / 2.5
```

**Crush curve (milestone 1.7, after the playtest).** "When a much bigger player attacks a
small one it should be way more rapid" (as in OpenFront). Before, speed rose in
proportion to the edge and stopped rising at 4×: a 30× army moved no faster than a 4×
one (5.7 tiles/s). Now the delay falls as r^1.3 down to 1/20, so overwhelming attacks
flood (~20 tiles/s). Losses per tile are unchanged (still halved at 2× and beyond), so
crushing is fast, not free. Even fights stay at ~2 tiles/s so the defender can react.
This shortened bot games from a median 9.7 to 7.1 min, mostly by ending the mop-up of
beaten players sooner (see ROADMAP 1.7).

**Why LOSS_DENSITY = 1.2 (changed from 0.8 after the first play-test).** Because the
attacker's cost scales with r = D/A while the defender loses d per tile, a fight follows
*Lanchester's square law*: an army A takes everything from a home pool D only if
A² > 1.2·D², i.e. with ~10% more troops. Equal armies stall with the defender keeping
~40%. With 0.8, a slightly *smaller* army could wipe out a neighbour in seconds right
after spawn protection ended — far too swingy. Attacking still pays off with an edge:
sending twice the defender's pool halves the cost per tile.

| Effect | Result |
|---|---|
| Commit more troops | Cheaper per tile *and* faster (r falls) |
| Defender fighting elsewhere | Their home pool is lower → easier to attack everywhere |
| Wide shared border | More frontier → faster attacks (for both sides) |
| Mountains | ~1.5× losses and ~2.5× slower than plains: natural defensive lines |
| Much bigger army | **Crush curve**: speed grows faster than the edge — grass: even 2 tiles/s, 2× ≈ 6, 4× ≈ 14, 10×+ ≈ 20 (the cap) |
| Two players attack each other | Their land armies collide and cancel out first; a landed army (boat or airborne) never does — it fights on its own front (D-029, 2B.4) |

- **Retreat:** cancel an attack from its chip (×). It stops advancing immediately;
  troops return after 2 s minus **20%** (no penalty when retreating from neutral land).
- An attack ends when its army is spent or nothing reachable remains; survivors return.

### 3.7 Directed attacks (our key combat improvement)

OpenFront attacks spread over the entire shared border; aiming is impossible
(their longest-standing feature request). We make **where you click matter**:

**As built (milestone 1.3) — fronts move in continuous time.** Every target tile next to
the attacker's land has a *ready time*; the attack takes it when that time has come and
it can pay the troop cost. Taking a tile puts its neighbours on the front:

```
ready(neighbour) = when this tile fell
                 + layer delay (terrain, army size, odds — §3.5, §3.6)
                   × direction pull  (1 toward the click … 1 + FOCUS_PULL straight away)
                   × (1 − FILL_SHARE × (own sides − 1))
                 + noise (0 … 1.5 ticks)
border tiles at launch start FOCUS_SPREAD ticks later per tile of distance from the
border tile nearest the click point
```

| Constant | Value | Effect |
|---|---|---|
| `FOCUS_SPREAD` | 0.35 ticks/tile | The attack opens near the click point and widens along the border at ~3 tiles/tick |
| `FOCUS_PULL` | 1.0 | A step straight away from the click takes twice as long as one toward it |
| `FILL_SHARE` | 0.29 | Each extra side the attacker owns cuts the remaining wait by 29% of a layer delay (1 − 1/√2): diagonal fronts advance as fast as straight ones, so fronts grow round instead of diamond-shaped, and gaps fill quickly |

Tiles near the click point fall first; the attack then widens outward from there.
This rewards **position**: drive toward a chokepoint, split an enemy in two, cut off a
pocket for encirclement, or avoid mountains. `FOCUS_SPREAD = FOCUS_PULL = 0`
reproduces a classic "whole-border" attack, so we can tune between the two in
playtests. (The first draft biased a priority queue toward the click point, but with a
per-tick budget proportional to the border, the whole border's budget would have poured
into one spot as an unrealistically fast spearhead.)

### 3.8 Encirclement

Every 2 s (staggered per player), any piece of a player's territory that is
**completely enclosed** by other players' land — touching no water, no map edge and no
neutral land — is annexed instantly by the surrounding player (if several surround it,
the one with the longest shared border, or the one actively attacking). Coasts are safe.

**As built (milestone 1.4):**
- A cut-off **pocket** (any piece except the player's largest) falls when enclosed, by
  one player or several. With several enclosers, the one attacking this player with the
  biggest army takes it, otherwise the one with the longest shared border.
- The player's **main territory** only falls when a *single* player surrounds it **and
  attacks them with an army at least as big as their home troops** (a real assault they
  would lose anyway). Otherwise every inland player bordered by two neighbours would be
  wiped out at once — and, as the milestone 1.5 play-test showed, a neighbour could
  swallow a whole player (troops and all) just by expanding around them, or with a token
  attack.
- Checks run every 2 s per player (staggered by id) and are skipped when nothing changed
  next to the player's land since the last check.

### 3.9 Elimination

- A player with **0 tiles** is eliminated.
- When an attacked player falls below **40 tiles** *and* holds at most **25% of the most
  land they ever held**, their remaining land is absorbed by their biggest attacker
  (avoids tedious mop-up). The peak-share condition (added in milestone 1.4) stops spawn
  rushes: a fresh 49-tile start that loses 10 tiles keeps going instead of handing its
  whole army over.
- An eliminated player's own armies are lost; armies attacking them come home. When the
  match ends, every army comes home.
- Eliminations are visible moments: toast, map pulse, name greys out on the
  leaderboard.

### 3.10 Victory & defeat

- **Victory:** control **≥ 80% of all land** (70% until the Phase 2B playtest, D-033), or be the last player standing. In team
  games a team needs **85%** together (2B.6 balance pass, §3.15).
- **Defeat:** your territory reaches zero. You may keep watching (spectate) or restart.
- **Anti-stall** (pulled into Phase 1 at milestone 1.7): after **15 min** the land
  requirement drops **1% every 30 s**, down to **50%** at 25 min. The HUD shows the
  current goal next to the clock ("Win 80%", amber once it drops) and a toast announces
  the start. Why: about 1 bot game in 100 ended as two equal players who kept cancelling
  each other's attacks (counters cancel armies 1:1, and equal armies stall by design,
  §3.6) — those games ran 40–60 min. Almost every other game ends by 16 min, so the rule
  only touches the stalemates (200-game check: longest game 24 min).

### 3.11 AI opponents (Phase 1)

- Use **exactly the same commands** as the player (expand, attack, retreat). No
  resource bonuses at any difficulty.
- Think every **2–5 s** (staggered, randomized per bot).
- Simple utility logic: expand into neutral land while it exists; keep a **reserve**;
  attack when above a **trigger** level, choosing targets by weakness (low density,
  already at war), proximity and threat; retaliate against attackers; avoid hopeless
  attacks.
- **Personalities** (different thresholds and target preferences): *Expander*,
  *Aggressor*, *Turtle*, *Opportunist*.
- Difficulty (later) = reaction time + decision quality, not stats.

**As built (milestone 1.5)** — `src/sim/ai/bot.ts`. Bots run inside the deterministic
simulation; their commands are queued and applied (and validated) at the start of the
next tick, exactly like a person's. On each think, in order:

1. **Counter** the biggest incoming army they can match (home ≥ 1.1× it), sending 1.3× its
   size: opposing armies cancel out, so this is cheap defence. A landed army doesn't cancel
   (D-029): the counter is aimed at its landing pocket and must take it tile by tile.
2. **Reinforce or retreat** an attack whose army fell below 30% of the defender's home
   troops (it would take only ~3% more of their land): top it up if the bot can afford
   to, otherwise retreat (saves 80% of what's left).
3. **Wait** until troops regrow to the personality's trigger share of capacity — growth is
   fastest at 50%, and a bot that keeps sending most of its pool barely grows.
4. **Expand** toward the nearest open land just beyond its territory (sampled; mountains
   and highlands avoided), topping up an expansion that runs low. *Sized to what the
   front can use* (milestone 1.7): a front takes one layer of tiles per layer delay, so
   an expansion carries ~15 s of what its front can spend (from the open land touching
   the bot's border), at least a full-speed army (2,000), and no more than the open land
   in reach costs (+25%). An expansion more than twice that size is called back (free
   from neutral land) and resent smaller. Before this, bots sent 30–45% of their pool and
   parked up to 250k troops in fronts that took ~100 tiles at a time; field troops count
   toward the cap, so their home pools stayed empty and barely grew.
5. **Attack** the neighbour where it expects to gain the most land. Using the Lanchester
   law (§3.6) a bot estimates how much of a target's land an army takes before it stalls:
   `share = 1 − √(1 − A²/(k·D²))`. It attacks when that share beats its personality's
   minimum — accepting smaller gains while its troops sit at the cap (wasted growth).
   Army size: enough to take *everything* if affordable — the bigger of a clear troop
   edge and the fixed per-tile cost of all the target's land (big, thinly held empires
   are cheap per tile but have many tiles). Target score = expected land gained ×
   (busy elsewhere) × (attacking us) × (depleted: low troops vs capacity) × 2 if it would
   finish them off. One war at a time, **reinforced** while it can still finish the job;
   aimed at the target's original start tile (it splits them and cuts off pockets).

| Personality | Expand at | Sends | Attack at | Min. land gain | Notes |
|---|---|---|---|---|---|
| Expander | 35% | 45% | 65% | 30% | Attacks only once no neutral land is left |
| Aggressor | 45% | 35% | 50% | 15% | Attacks even while expanding; likes busy targets |
| Turtle | 50% | 30% | 75% | 40% | Cautious, big edges only |
| Opportunist | 40% | 40% | 55% | 25% | Strongly prefers targets busy fighting someone else |

How we got here (headless runs on the reference map, 8 bots):
- *Attack only with a clear edge* → every bot sat at full capacity and nobody ever moved
  (a defender fights with its whole home pool, an attacker with part of its own).
- *Attack for expected land gain* → constant fighting but endless churn: 27 of 100 games
  had no winner after 60 min, median 27 min. Armies were sized without the per-tile cost,
  ran out halfway through big territories, and were never reinforced, so nobody was ever
  finished off.
- *Size armies to finish targets, prefer depleted ones, reinforce* → games end on their
  own: 10/10 in 10–18 min (median 13) in the first check; see ROADMAP for the 100-game
  result.
- *Milestone 1.7*: right-sized expansions (above) shortened the land race and the
  longest games and reduced snowballing. Aggressors win ~18% of games (fair share 25%);
  four variants (wait longer, no attacking while expanding, smaller attacks, prefer busy
  targets) all stayed at 12–19%: attacking costs more than defending, so the most
  aggressive style is a bit weaker by nature. Accepted — no personality dominates
  (the best wins ~30%), and aggressors are the ones that keep the player under pressure.

### 3.12 Big lobbies (milestone 2.0)

Up to **125 opponents** (126 players), like OpenFront's crowded solo games (§3.21 of the
research: 400 filler bots). Design note written before building; results below.

| Question | Decision | Why |
|---|---|---|
| Room per player | Reference map: 420k land ÷ 126 ≈ **3,300 tiles** each (radius ~32) — small but playable. New **Large** map (1560×990, same seed and generator): ~850k land, **~6,700** each | Each start still has a land race; Large gives a 125-bot game the room of a 63-bot one. Real "big lobby" maps come with 2.7 |
| Spawn spacing | Preferred distance = min(70, **0.7 × √(land ÷ players)**): 70 for 8 players (unchanged), 40 for 126 on Normal, 57 on Large; relaxed step by step as before | With a fixed 70 the first ~50 bots took the room and the rest were squeezed in at 34 or less (and placing them took ~30 ms); random disc packing fills ≤ 55% of the area, so 0.7 of the even spacing fits |
| Which bots | Today's four personalities, unchanged | Tribes and Nations are milestone 2.1; 2.0 is about scale only |
| Bot thinking | Unchanged: every 2–5 s, randomly staggered (126 bots ≈ 3.6 thinks per tick) | Measured: bots cost 0.06 ms per tick on average — no budget needed |
| Colours | 15 hand-picked colours, then generated ones: each the candidate farthest (OKLab) from every colour in use, the terrain colours and the local player's blue | Closest pair of 126 colours ≈ 0.056 OKLab (~2.5× a just-noticeable difference) |
| Names | 136 invented names | One per opponent, no repeats |
| Start screen | Stepper 1–125 plus quick picks **7 · 25 · 50 · 125**; map **Normal / Large**; "≈ N tiles of land per player" (amber hint to pick Large at 50+ opponents on Normal) | Clicking + 118 times is no fun; the land line makes the map choice concrete |
| Toasts | In lobbies over 16 players, another player's elimination is a toast only if they bordered you | ~120 eliminations per game would flood the toast stack |
| Labels, leaderboard | Unchanged: labels already fade out when a territory is too small to read; leaderboard shows top 5 + you and "N of 126 left" | Checked in the browser: no clutter at any zoom |

**Results** (100 headless games each, ROADMAP 2.0): every game ends with a winner;
126 bots on Normal: median 10.6 min, 90% of the land owned after 37 s; on Large: median
13 min, 54 s. The leader at minute 3 rarely wins (4–12%) — big lobbies are less
snowbally. But **turtles win 70–80%** (34% in 8-bot games): with many small neighbours,
patience and mountain lines beat attacking. Left for 2.1 (Tribes & Nations).

### 3.13 Tribes & Nations (milestone 2.1)

Two AI tiers (D-016; ideas from OpenFront, research §3.21–3.22; our own numbers and code).
**Tribes** are many weak filler bots — "food" that fills the map. **Nations** are the
real opponents: today's personality bots with a difficulty level. Tribes are weaker by
stats; Nations get no bonuses or penalties (D-017, D-012).

| | Tribe | Nation |
|---|---|---|
| Troop capacity | **⅓** of normal | normal |
| Growth | **½** of normal | normal |
| Attacked by a non-tribe | attacker loses **0.7×** per tile | normal |
| Thinks every | 4–8 s | Easy 6–10 s · Medium 4–7 s · Hard 2–5 s |
| Decisions | expand while open land is near; otherwise, at ≥ 55% of capacity, attack a random weak neighbour with 30% of its troops; never counters, reinforces or retreats | everything in §3.11; Easy never counters or reinforces, Medium counters but doesn't reinforce, Hard does both |
| Names | the invented names list | invented country names |
| Colours | **dull browns and tans** (low saturation, darker than highland terrain) | bright colours, kept away from the browns |
| Labels | small name (≤ 12 px), lighter; troops only when zoomed in close | bold name up to 26 px; troops at 60% of the name size |
| Spawns | **scattered at random** — only 9 tiles from other tribes (discs never overlap, clumps welcome) and 20 from nations | spread evenly among nations and humans (§3.12 spacing, counting only them) |
| Targets (nations) | — | tribe targets weigh **3×**; up to **3 wars on tribes** at once, one war at a time against a nation |

- Why handicaps by stats (user's choice, D-017): full-strength tribes would hold full
  armies everywhere, so attacking them would cost as much as attacking a nation and the
  map would stall. A third of the troops and cheaper land make them the obvious first
  targets — the early game becomes "eat the tribes, then fight the nations".
- The tribe discount is part of the battle estimate (`battle.ts`), so the HUD's odds and
  the nations' target choice both know a tribe is cheaper.
- Lobby: the start screen sets **Nations** (0–25, default 7), **Tribes** (0–125, quick
  picks 0 · 25 · 50 · 100, default 25), **Difficulty** (Easy · Medium · Hard, default
  Medium) and the map; at most 125 opponents in all.
- Done when (ROADMAP): mixed lobbies (e.g. 100 tribes + 10 nations) feel right; tribes
  don't win, nations do.

**As built (results, ROADMAP 2.1).** In 10 nations + 100 tribes, nations win every game
at every difficulty (150/150). A first version took 17–19 min: nations fought each other
from minute 2 (a nation that sends most of its pool is crushed in seconds by the next
one — the crush curve — and a tribe then absorbs the last scraps), and the last nation
ate the ~50 remaining tribes one at a time. Preferring tribes (×3) and eating up to three
at once brought games to **Hard 9.7 · Medium 12.6 · Easy 16.7 min** (median). With
tribes in the lobby turtles no longer dominate (Medium: turtle 17, expander 16,
aggressor 10, opportunist 7 of 50). The tribe colours were the user's request after the
first look ("dull brown/tan like OpenFront"). After the first playtest: tribe names and
all troop numbers were too big on the map (made smaller; tribe troops only when zoomed
in), and evenly spaced tribes looked "very organized" (now scattered at random, nations
still spread evenly). Tribe populations themselves were fine and are unchanged.

### 3.14 Alliances (milestone 2.2)

Timed, renewable alliances with a price for betrayal (D-016; ideas from OpenFront, research
§3.19 and §3.21 — our own numbers and code). Design note written before building; results
below. All numbers live in `rules.diplomacy`; `enabled: false` turns the whole system off
(lobbies then play exactly as in 2.1 — the regression check).

**The rules**

| Rule | Value | Why |
|---|---|---|
| Ask | Any living player, any time during play (spawn protection included); you don't need to border them | Alliances are about the whole map, not only neighbours |
| Request expires | after **20 s** | Long enough to read and decide, short enough not to linger |
| Ask the same player again | after **30 s** (from your last request to them) | No request spam |
| Both asked each other | the second request **accepts** the first | Natural: two players clicking "ally" at each other are allies |
| Allies | **can't attack each other**; armies already fighting between them come home **without** the 20% retreat loss | Forming an alliance is peace, at once and at no cost |
| Encirclement | allies never capture each other's land; a piece enclosed only by allies is safe; with mixed enclosers only the non-allies count | Otherwise an ally could swallow your pockets for free |
| Lasts | **5 min**, then ends on its own | Alliances are recurring decisions, not permanent blocs |
| Renew | in the last **30 s** both players are asked; if **both** agree it is extended by 5 min | Either side can let it lapse without becoming a traitor |
| Break | at any time; the breaker is a **traitor for 30 s** | Betrayal is possible but costly |
| Traitor | anyone attacking a traitor loses **0.6×** troops per tile and moves **1.33× faster** (0.75× the delay per tile); tribes attack a neighbouring traitor first; nations weigh traitors **2×** as targets (user request during 2.2) and the betrayed nation holds a grudge | A visible, short window of weakness: the betrayed side and its neighbours can strike back |
| How many | **no cap** for players; nations hold at most 2 alliances (bots' own restraint) | A human may ally many tribes — but then can't eat them without becoming a traitor; the trade-off is the decision |
| Victory | **only your own land counts** (80% or last standing); alliances don't share a win | Shared victory is what teams (2.3) are for. Two allies left alone will have to fight: nations never ally or renew when only two contenders are left |
| Elimination | an eliminated player's alliances and requests vanish | — |

**AI**

- **Tribes** accept every request and renewal (on their next think, 4–8 s), never ask,
  never break. Once regrown they attack a neighbouring traitor (who isn't their ally)
  before anything else — even while open land remains.
- **Nations** never ally tribes (tribes are food) and decide everything else by *threat*,
  *strength* and *shared enemies* (strength = home + field troops):
  - they refuse traitors, anyone who betrayed *them* in the last 5 min (a grudge), a
    runaway leader (≥ 25% of the land), anyone when they already hold 2 alliances, and
    anyone when only two contenders (nations and humans) are left;
  - they refuse a player they are beating (their own attack on them is expected to take
    ≥ 40% of the land);
  - a **neighbour** is welcome if it is clearly stronger (≥ 1.25×, appeasement), if both
    fight the same enemy, or if the nation is at war with another nation or human and the
    neighbour isn't much weaker (≥ 0.6×, a safe flank); a far-away player is welcome if
    it is not much weaker (≥ 0.6×). Turtles accept from 0.8× without a reason;
    aggressors want 1.5× from neighbours;
  - **asking**: at most one request per think, to the strongest bordering player it would
    welcome, at most every 90 s per player;
  - **renewing**: if it would still welcome the ally;
  - **betraying**: an ally counts as a target again when an attack on them is expected
    to take nearly all their land — Hard betrays then whenever its personality allows,
    Medium sometimes; Easy betrays at random and earlier (even for half their land).
    Turtles never betray, expanders half as often, aggressors and opportunists fully;
  - **Easy** nations are "confused": a quarter of their answers are flipped at random
    (Medium a tenth, Hard never).

| Difficulty | Betrays for at least | Chance (× personality) | Answers flipped |
|---|---|---|---|
| Easy | 50% of the ally's land | 15% | 25% |
| Medium | 90% | 30% | 10% |
| Hard | 99% | 100% | 0% |

**HUD**

- **Right-click menu** on another player: *Request alliance* (or *Accept their request*,
  *Request sent · 14 s*, *Ask again in 18 s*); on an ally: *Allied · 3:12 left* and
  *Break alliance* (asks for a second click: "you'll be a traitor for 30 s"). Allies show
  no attack options.
- **Keys:** **K** = ally with the player under the cursor (request or accept); **Y / N**
  = yes / no to the top diplomacy card.
- **Diplomacy cards** (left, under the you-chip): incoming requests with a 20 s bar,
  *Accept* / *Decline*; renewal prompts in the last 30 s ("Alliance with X ends in 0:24")
  with *Renew* / *Let it end*, then "Waiting for X…".
- **Toasts:** accepted, declined, expired, ended, renewed, "X betrayed you!", "You
  betrayed X — traitor for 30 s"; others' betrayals only if one of them borders you.
- **Map:** allies' borders in mint, a little thicker; a traitor's land carries moving
  coral stripes while the mark lasts; allies' names in mint.
- **Leaderboard:** a handshake mark by allies; a *traitor* tag.
- **Hover card:** "Ally · 3:12 left", "Traitor · 24 s — attacks on them cost less"; the
  preview says "Allied — break the alliance first (right-click)". The odds include the
  traitor discount (`battle.ts`), like the tribe discount.

### 3.15 Teams (milestone 2.3)

A second game mode next to free-for-all: players and nations split into 2–8 fixed teams
that win together (D-016, D-019; idea from OpenFront's team games, research §3.12 and
§3.27 — our own rules and code). Teams are how friends will queue together once
multiplayer exists (Phase 3); in solo games your teammates are nations. Design note
written before building, with the user's answers of 2026-10-02; results below.

**The rules**

| Rule | Value | Why |
|---|---|---|
| Mode | **Free-for-all** (default) or **Teams**, with **2–8 teams** (at most one team per nation + you) | Two to four teams is the common case; 8 keeps team colours distinct |
| Who is on a team | You and the nations, dealt round-robin (you first: team 1, nation 1 → team 2, …), so team sizes differ by at most one. The start screen shows the split ("4 v 4", "you + 2 nations") | Fair by construction; no hidden rules |
| Tribes | **No team** — weak filler that every team eats, as in free-for-all (user) | Tribes are food; you may ally one early to grow safely next to it |
| Teammates | permanently friendly: **can't attack each other**, never encircle each other's land (a piece enclosed only by teammates and allies is safe), can't be broken up | A team is a fixed side; same checks as an alliance (`areFriendly` = same team or allied) |
| Alliances | **Exactly as in free-for-all** (§3.14), with anyone outside your team, tribes included — always requested, timed, renewable, betrayal makes a traitor. Asking a teammate is pointless and rejected (user) | Politics between teams stay possible; teams don't replace diplomacy |
| Victory | a team wins when its members' **combined land** reaches the goal (**85%** since 2B.6 — was 70%; the same anti-stall decline to 50%), or when **no other team has a player left** (leftover tribes don't block it — they can't win) | Shared victory is what teams are for. **Allied teams never win together**: alliances don't add land (user) |
| Last two sides allied | they must let the alliance run out — or break it and be a traitor; if they keep renewing, the game goes on (user). Nations count *sides* (teams) when deciding "only two contenders left", so they won't ally or renew then | Unchanged from §3.14, counted by team |
| Eliminated but your team wins | you still win ("Victory — your team…") and can keep watching | Team play: your part counted |
| Spawns | **unchanged**: nations are spread evenly at random, tribes scattered, you pick your own spot (your teammates' colours are visible while you choose) (user) | No team regions; the spawn phase stays the same in both modes |

**AI (team-aware nations).** Nations never target a teammate (and never ask one for an
alliance). Among their usual targets they prefer an enemy who is **attacking a teammate**
(×2, "help teammates") and an enemy a teammate is **already attacking** (×1.5, "gang
up"), so a team tends to focus fire. Everything else (tribes first, traitors 2×,
difficulty, personalities, alliances with players of other teams) is unchanged. Tribes
play as before; a tribe has no team.

**HUD**

- **Start screen:** *Mode* Free-for-all · Teams; in Teams a *Teams* stepper (2–8) and the
  split ("Your team: you + 3 nations · 4 v 4").
- **Colours:** each team has a hue (team 1 is your blue, then red, saffron, violet, teal,
  orange, pink, slate); members get distinct shades of it — you keep the familiar bright
  blue. Tribes stay brown.
- **Leaderboard:** a *Teams* block on top — each team's combined land and members left,
  your team highlighted — above the usual player list; a *team* tag on your teammates.
- **Hover card / right-click menu:** "Teammate · Team Blue" (no attack options, no
  alliance options); other players show their team name.
- **Map:** teammates' names in mint and their borders marked like an ally's (friendly at a
  glance).
- **Toasts:** a teammate eliminated; a team knocked out.
- **End card:** "Victory — your team controls 70% of the land" / "Team Red won the match."
- **Headless:** `--teams N` (nations dealt round-robin), team wins, and a check that
  teammates never fight.

**As built (results, ROADMAP 2.3).** Every team game ends with a winning team and no
teammate ever attacks another. 4 v 4 nations without tribes take a median 4.7 min (with
100 tribes 7.3; 4 teams of 3 with 100 tribes 11.2) and the team ahead at minute 3 usually
wins — each team starts with about half the land. Neither dropping the "gang up" weights
nor an 80% team goal changed that much, so the goal stays 70%; the playtest decides. With
two teams, nations don't ally across teams (two sides left).

**2B.6 balance pass: the team goal is 85%.** With buildings, boats and air in the game, 4 v 4
nations on Islands still ended as the land race did (median 5.5 min, a level-III building in
3 of 30 games), so team games never reached Phase 2B's content. At 80%: 6.6 min, 8 of 30;
at **85%: 9.3 min, 16 of 30** (Two lands: 5.9 → 8.1 min), both teams still winning about
equally often. Free-for-all keeps 70%. The HUD's goal ("Win 85%") follows the mode.

### 3.16 Economy: gold, Mobilize, donations (milestone 2.4)

> **D-033 (2026-10-16): Mobilize is gone.** After the Phase 2B playtest the user called it
> "over powered" and asked to remove it entirely: gold now buys buildings, walls and missiles
> (and can be given to friends); troops come only from land and Housing, and Housing gives
> 2.5× the capacity it did. The Mobilize rows and the war chest below are history. The
> command bar's Mobilize button became the missile launcher (§3.17.8).

Model **E2 + Mobilize** (§6.1, Q6): gold comes from land, sublinearly, and before
buildings exist (2.5) it buys one thing — troops, instantly, within your capacity.
Donations between friends (§6.4) come with it. Design note written before building; the
user chose on 2026-10-02 that **troops can be donated too**, with limits (D-020).

**The rules**

| Rule | Value | Why |
|---|---|---|
| Income | every tick of play: **10 + 0.8 · √tiles** gold (rounded down). Spawn start (49 tiles) ≈ 16/tick (160/s); a mid-game empire of 50k tiles ≈ 190/tick (1.9k/s); 200k tiles ≈ 370/tick | "Land = income" is intuitive; the square root damps the snowball (4× the land → 2× the gold). The base keeps a small player in the game |
| Tribes | **half** the income, and they **never spend it** | They're filler (D-017); their gold piles up as loot — eating a tribe that survived long pays |
| Mobilize *(removed, D-033)* | spend **1 gold per troop** for instant home troops, at most up to your capacity (home + field ≤ capacity, as always). The HUD buys **10% of your capacity** per click (key **M**); if gold is short it buys what you can afford | Gold is a reserve army that doesn't count toward the cap and can't be killed — but deploying it fills you past the growth sweet spot. Best right after an attack (back to ½, where growth peaks) or right before one |
| How much it's worth | spending all income ≈ **+20% of peak troop growth** at every size (early 16 vs 75 troops/tick, mid 190 vs 1,040) | Noticeable, not dominant; buildings will compete for the same gold |
| Loot | conquering a player (eliminating them) gives you **all their leftover gold** — nations' and tribes' alike (user request during 2.4; the note first said half). On the map the capturer's border shimmers gold for ~2 s and "+12K" with a coin rises from where the captured land was | Finishing players off pays, and you see it pay. Nobody gets the gold if no one eliminated them |
| Donations | *(Planned change, D-023, milestone 2.5: troops only to a friend you share a border with, or by airlift from an Airport in 2B.1; gold unchanged.)* To an **ally or teammate**: troops (from your home troops) or gold, a share chosen with the usual send % (default 25%). Each kind to each friend at most every **10 s**. Troops can't push the friend over their capacity (only what fits is sent; nothing if they're full) | Rescue a friend under attack, or pool gold in a team. The cap and the cooldown limit "feeding" one player (D-020) |
| Off switch | `rules.economy.enabled = false` (headless `--no-economy`): no gold at all, games play exactly as in 2.3 | Regression check |

**AI (as built; the war chest until D-033).** *Nations* keep gold as a **war chest**: right before they attack a
player they mobilize all it buys (if that's at least 2% of their capacity), so gold makes
their strikes stronger. They **give troops** — a quarter of their home troops — to a
teammate or human ally who is losing a war (incoming armies bigger than the friend's home
troops), if they aren't under attack themselves and sit at their attack threshold; and a
nation at its cap (gold it can't use) gives half its gold to the teammate or human ally
with the emptiest army (below half). They **don't give to allied nations.** *Tribes* only
earn. Why (headless, 10 nations + 100 tribes, Medium, 30 games): the first version —
refill to half capacity after every attack, all-in defence, gifts to any friend — made
every nation harder to beat and stretched games from 13 to 18 min; spending gold on attacks
alone gave 14.9 min, and also dropping gifts between allied nations (who propped each other
up) 11.6–12.1 min.

**HUD**

- **Command bar:** gold and income next to the troop numbers; a **Mobilize** button with
  the troops it buys and their cost (key M), disabled at the cap or without gold — replaced
  in D-033 by the missile launcher (once you own a Silo) and "🏠 +75K", the capacity your
  Housing gives.
- **Right-click menu on an ally or teammate:** *Send troops* and *Send gold* with the
  current send % and the amounts, or the seconds left on the cooldown.
- **Hover card:** other players' gold.
- **Toasts:** troops/gold received from a friend; loot taken ("You took 12k gold from …").
- **Headless:** `--no-economy`; per game gold earned, mobilized, donated and looted, and
  the median gold income at minutes 1, 3 and 6.

### 3.17 Buildings & strategic warfare — design (2026-10-02; built 2.5 – 2B.6)

> **Status (2026-10-14):** all built — Housing, Factory (2.5, war production 2B.5), walls
> (2.6), Port I–II (2.7), trade (2.8), flights (2B.0), Airport I–III (2B.1, 2B.3, 2B.4), SAM I–III
> (2B.2; against missiles 2B.5), Missile Silo I–III (2B.5), Port III Naval Base with warships
> and coastal fortification (2B.6, §3.18.1); every row of §3.17.10 is marked ✅.
> It is the design the user asked for on 2026-10-02 (seven buildings with three levels each, Border
> Defense, SAMs, Missile Silos and Airports) — written *before* any code. The user's
> answers of 2026-10-02: air & strategic warfare comes **before multiplayer** (Phase 2B,
> built bots-first); **troop gifts only over a shared border or by airlift**; **longer games
> are fine**. Every number is a starting point for headless tuning. Where each part is
> built: ROADMAP (2.5–2.7 and Phase 2B). Decisions: D-021 – D-023.

**The test for every rule below: would this still feel like OpenFront?** The player
should still spend most of the game looking at the map, expanding, watching borders,
managing troops and attacking. Buildings support territory; they never replace it.

#### 3.17.1 How OpenFront's buildings work today (source re-checked 2026-10-02)

Studied in OpenFront's current source (commit of 2026-10-01) — details in
`OPENFRONT_RESEARCH.md` §3.14 and §3.18. Summary in our words:

| | OpenFront today |
|---|---|
| Roster | City, Port, Factory, Defense Post, Missile Silo, SAM Launcher (+ Warships, nukes) |
| Gold | flat **1,000 gold/s** per player (not tied to land) + trade ships and trains |
| Costs | City/Port/Factory start at 125k and **double with each one you own** (cap 1M); Defense Post 50k more per post (cap 250k); SAM 1.5M more per SAM (cap 3M); Silo 1M |
| Build time | 2 s (City, Factory) · 5 s (Port, Defense Post) · 10 s (Silo) · 30 s (SAM) |
| **Levels** | Unlimited. "Upgrading" = buying the same building again on top of it; each level counts as one more building for the price doubling. Bulk upgrades up to 50 levels at once |
| What a level does | City: +capacity per level (the gold→troops converter). Port: one more trade-ship roll per level. Factory: counts as one more factory for trains. Silo: one more missile slot (each reloads in 9 s). SAM: more range (70 → 81 → 90 …, toward 150) and one more interceptor per level |
| Defense Post | not upgradable; enemy attacks on the owner's tiles within 30 tiles lose **5×** troops and move **3×** slower; **destroyed** when its tile is captured |
| Capture | other buildings are **captured** with their levels when their tile falls; nukes delete buildings |
| SAM | pre-computes where a nuke will pass and fires one interceptor that **always hits**; limited by interceptors and reload — no dice rolls |
| Spacing | buildings at least 15 tiles apart |
| AI | nations build cities first, then ports/factories (~0.75 per city), SAMs (0.15–0.3 per city by difficulty), up to 3 silos; defense posts only near a front under attack |

What makes it work: every building has **one sharp job**, effects are **global and
simple** (a City is just "+troops"), and the one local building (Defense Post) creates
real chokepoints. What is weak: unlimited levels are opaque (a "level 23 city"), the
economy behind ports and factories (trade/train curves) is invisible to players, and
levels are not readable on the map.

#### 3.17.2 Proposal vs OpenFront — what changes and why

| Topic | OpenFront | Proposal | Why |
|---|---|---|---|
| Levels | unlimited, each = one more copy | **exactly 3**, each with a name and a visible look | Readable at a glance; a level-3 building is an *event*, not a stack |
| Upgrade benefit | +1 copy of the same effect | **better effect + one new ability** at levels 2 and 3 where it makes sense | The user's brief; creates "upgrade vs build another" decisions |
| Cost growth | each copy doubles the price | upgrades ≈ 2.5× and 6× the base price; every level you already own of that type adds **+25%** to the next one (max ×3) | Same anti-spam idea, gentler and shown on the card |
| Defense | a point with a circular zone | **Walls** drawn point by point on your land (D-024, user — first built as a post fortifying the border, D-022) | The user's brief: Clash of Clans-style walls that enemies push through (§3.17.6) |
| Damage | none (nukes delete) | **level is the health**: hits knock a building down one level | No HP bars, no repairs; the tier you see is the state |
| Air | none | **Airport** I–III: airlift to friends, airborne assault, air strikes | New strategic layer — the biggest risk to the feel (§3.17.3) |
| Missiles | atom/hydrogen bombs, MIRV; fallout | Silo I–III: conventional missiles first, one strategic warhead at level 3 | Late-game counter to runaway leaders without an early nuke meta |
| Gold | flat + trade/trains | ours (E2, §3.16): land-linked, √tiles; Factory and Metropolis add to it | Keeps the economy legible |

#### 3.17.3 Mechanics that could break the OpenFront feel — and the guard against each

| Risk | What could go wrong | Guard in this design |
|---|---|---|
| **Teleporting armies** | Airborne assaults make geography meaningless | Range rings, a cap per flight (share of your capacity), cooldowns, SAM losses, a 1.25× loss penalty for light airborne troops, landings must be on hostile land, and a landing pocket can be encircled once its attack stops. And our troops are one pool: a small airdrop against a full home pool is *Hopeless* — airborne works against busy or depleted enemies, exactly like a second ground front |
| **Turtle meta** | Walls + SAMs + Housing make defending stronger than attacking. Turtles already win ~half of tribe games (ROADMAP 2.4) | Walls are lines that break tile by tile and can be gone around (as built: turtles won 13/50 tribe lobbies in 2.6, 2.5: 25); airborne, missiles and strikes bypass them; multipliers below OpenFront's 5×; headless check on turtle wins is a "done when" of milestone 2.6 |
| **Base-building game** | Players stare at menus instead of the map | 7 buildings, 3 levels, no tech tree, no new resources (gold + troops only), one small card per building, no repairs, no production queues |
| **Flight-sim micro** | Players steer planes | Every air/missile action = origin, target, commitment, go. The simulation flies, fights and returns |
| **SAM bubbles** | Overlapping SAMs make the sky impenetrable | No stacking bonuses: each SAM fires its own few interceptors, each kills one plane; saturation (several flights, or strike the SAM first) beats it; SAMs are expensive and their radius small next to a territory |
| **Snowball** | Rich players build L3 everything | Price grows +25% per level you own of a type; L3 totals are 8–10× the L1 price; gold income is √land; gold also buys troops (Mobilize), so every building is a troop you didn't buy |
| **Short games** | Our games last 7–13 min (median); L3 airports/silos would never appear | Costs are sized to *our* economy (§3.17.12) and we measure game length every milestone. **User (2026-10-02): longer games are fine** — L3 warfare should appear in a normal game (§3.17.12) |
| **Instant gifts vs airlift** | Troops can already be gifted instantly to any ally anywhere (D-020) — an airlift would be pointless | **User (2026-10-02, D-023):** troops go to a friend **only over a shared border or by airlift** (Airport I) — not by boat. From milestone 2.5 on. Gold gifts stay instant everywhere |

**Several fronts at once (unchanged).** As in OpenFront you can attack several players at
the same time — one army per enemy. It's risky for the same reason: troops in the field
leave your home troops low, so everyone you border finds you cheaper to attack. Against
the *same* enemy, land clicks add to that enemy's army and move its aim (OpenFront merges
land attacks on one target too). What changes with boats (2.7) and airdrops (2B.3): a
landing is its **own** army, separate from your land attack on that enemy — as OpenFront's
boat attacks are.

#### 3.17.4 Shared rules for all buildings

| Rule | Proposal |
|---|---|
| Where | on your own land; at least **8 tiles** from your other buildings (OpenFront: 15 on maps ~3× bigger). Port: coastal tile. Airport: plains. Allowed from the first tick of play (not during the spawn phase) |
| Pay | gold up front (the HUD shows the price including the +25% per level owned) |
| Construction | L1 5–15 s, upgrades 10–30 s (table). A building under construction does nothing; one being **upgraded keeps its old level working** until the upgrade finishes |
| Level = health | an air strike or missile knocks a building down **one level** (L1 → destroyed). No HP, no repair: re-upgrade if you want the level back |
| Captured tile | **the taker adopts the building at its level** (user, 2.5 playtest — like OpenFront): taking a Metropolis is a prize, losing one hurts. An unfinished building is lost, an upgrade in progress is cancelled, tribes destroy what they take. **Missile Silos are destroyed** instead (too swingy); a **wall** tile that changes hands breaks (§3.17.6) |
| Eliminated owner | their buildings go to whoever takes the land (same rule) |
| Cancel / sell | no selling (OpenFront has delete; it adds little). Cancelling a construction refunds 50% |
| Disabled | struck buildings are **disabled for 20 s** (no effect, no actions), shown greyed |
| Escalation | every level you already own of the same type makes the next build or upgrade **+25%** dearer, at most **×3** |
| Same for bots | nations use the same commands and prices (D-012); tribes never build (filler) |

#### 3.17.5 Unified range system

One module answers every "how far / in range / how long" question (ARCHITECTURE §5.7):
`distance(a, b)` (straight line, in tiles), `withinRange(a, b, r)` (exact: compares squared
distances, no square root), `travelTicks(a, b, speed)`. Air units, missiles, SAM coverage,
Factory supply, building spacing and the HUD's range rings all use
it. Boats use their water-path length through the same `travelTicks`. **Display:** 1 tile
= 1 km ("Range 300 km"); the reference map is ~1,100 km wide. Ranges are fixed in tiles
and will be re-checked when bigger maps arrive (2.8).

#### 3.17.6 Border Defense — walls drawn point by point (✅ milestone 2.6, D-024)

**User (2026-10-02, while 2.6 was in the browser check):** walls placed with points A, B,
C … until the shape is built — a buff that enemies push through, like Clash of Clans walls.
This **replaced** the first 2.6 design (D-022: a post whose circle fortified the owner's
border, drawn as a wall line). The user's answers: walls **replace** posts; wall tiles are
**hard** (go around or break through); walls go **anywhere on your land**.

**Drawing.** Pick *Wall* in the build bar (priced per tile). Click your land for point A,
then B, C …: each piece is a straight line between two points, 8-connected (fronts spread
to the four neighbours of a tile, so they can't slip between two diagonal wall tiles). The
line follows the mouse in green (allowed) or red, with its length and price. Right-click,
Enter or a second click on the last point builds it; Esc cancels. Up to 12 points and 80
tiles per wall; every tile must be your land, not water, not a building. Crossing or
touching an existing wall joins it (its tiles aren't built or paid again).

**What a wall does.** A finished wall tile is hard to take. An attack must **hold** there
(3 / 6 / 10 s at even odds; a bigger army is faster by the square root of its speed-up, but
never below half) and pays **×loss + break troops** for it (×3 + 150, ×5 + 500, ×8 + 1,500).
So fronts flow around the ends and through gaps, and a wall closed against the coast,
mountains or another wall forces a break-through. Neutral land never has walls (expansion
is never slowed). Measured (3× the defender's troops): an open border falls after 0.6 s,
a Palisade after 2 s, a Fortress Wall after 5 s.

| Situation | What happens |
|---|---|
| An enemy takes a wall tile | that tile **breaks** (a gap); the rest stands. Retaking the tile doesn't rebuild it |
| The last tile breaks | the wall is gone ("X broke through your wall") |
| Your border moves past the wall | it stays where it was built: a second line inside your land |
| You lose the land the wall stands on | those tiles break (taken, encircled or absorbed — any change of hands) |
| Two walled players meet | each wall only matters to whoever attacks through it |
| Allies, teammates | can't attack each other, so walls don't matter between them |
| Under construction / upgrading | no effect until finished; an upgrade keeps the old level working |
| Buildings | can't stand on a wall; a wall can't go through a building |

| Level | Name | Gold per tile | Build time | Hold (even odds) | Attacker loss per tile | Look |
|---|---|---|---|---|---|---|
| I | Palisade | 600 | 4 s + 0.1 s/tile | 3 s | ×3 + 150 | brown stakes |
| II | Stone Wall | +1,500 | 8 s + 0.1 s/tile | 6 s | ×5 + 500 | grey blocks, towers at the ends |
| III | Fortress Wall | +4,000 | 15 s + 0.2 s/tile | 10 s | ×8 + 1,500 | thick light stone with merlons, big towers |

A whole wall upgrades at once (the price counts the tiles still standing). Prices escalate
like buildings: +25% per 60 wall tile-levels you own (at most ×3). Cancelling refunds 50%.
A 40-tile Palisade costs ~24k (about a Housing); upgrading it to a Fortress Wall ~250k more.
The HUD odds include a wall where you point (the same loss factor as the simulation); the
hover card names the wall and its effect. *As built (2B.3):* a Fortress Wall's **flak** — a
hostile flight (anyone's who isn't your friend: assaults, airlifts, later strikes) that flies
within 3 km of a standing tile of it loses one plane, each time it flies into that reach
(crossing a wall line once = one plane). A wall never shoots at friends. Cheap compared to
its price, and exactly the counter airborne assaults over walls needed.

**Why it still feels like OpenFront:** walls are lines on the map you react to, not a
base-building screen; there are no HP bars — a wall tile simply falls later and costs more;
a big army still pushes through, just slower and dearer. **The trade-off:** a wall right on
your border breaks at the first push — built a few tiles inside, it is a real second line.

**Nations** (`ai/build.ts`): a neighbouring nation or human that isn't a friend and attacks
them, or has at least 60% of their troops, is a threat. A nation draws one straight wall
5 tiles behind a threatened stretch of its border that no wall guards yet, across the way
in, up to 40 tiles, clipped to its own clear land (turtles up to 3 walls, expanders and
opportunists 2, aggressors 1), valued per gold against Housing/Factory; it upgrades walls
that still face a threat. Attacking, nations count walls on the shared front in their
estimates and aim at an open stretch of it.

#### 3.17.7 Airports, SAMs and air warfare

**Who needs an airport:** only the **sender**. Destinations need nothing (an ally without
an airport can still be reinforced; a target can't refuse). Receiving airports add
nothing — one less rule to learn.

**Flights** (✅ foundation built in 2B.0). Every air action is a *flight*: a group of planes
flying in a straight line from the airport to the target at a fixed speed, visible to
everyone on the map, with an ETA. Nothing is instant. *As built:* each flight is drawn as an
aircraft in its owner's colour with "×planes", on a dotted line to its target (yours light
with the ETA, hostile ones aimed at your land red, others faint); a hostile flight at your
land joins the incoming-threat warning (§3.20: chip, red ring and countdown, edge arrow, a
toast, the horn once per sender per 30 s). Until Airports exist (2B.1) flights can only be
launched with a debug test command in development builds. Art: the user's icon pack
(airplanes by Airport level, helicopters for airborne assault) arrives in 2B.0b (D-028).
*As built (2B.1):* **Airport I** (120k, 15 s, on plains) and the **airlift**: your Airport's
card has "✈ Airlift troops — up to N" (10% of your troop capacity); click it, then a
friend's land within the dashed 250 km ring (a green line shows the troops and the flight
time; red with the reason elsewhere). The send % sets the share of your home troops. Four
transports fly it; on arrival the troops join the friend's home troops, and what doesn't
fit under their capacity flies back to you (all of it if they are no longer your friend).
Then the Airport needs 30 s. Toasts tell both sides. Nations airlift to a teammate or human
ally losing a war beyond their border, and build an Airport only while such a friend is in
need and within reach.

| Flight | Planes | Speed | Carries |
|---|---|---|---|
| Airlift / airborne transport | 4 transports (+2 escort fighters from an Air Base) | 2 tiles/tick (20 km/s) | up to the airport's capacity, split evenly over the transports |
| Air strike | 4 fighters | 3 tiles/tick | — |
| Missile (Silo) | 1 missile | 3 tiles/tick | warhead |

**SAMs vs aircraft — the one rule.** A SAM has a few **interceptors** (1 / 2 / 3 by level)
that reload one at a time. When a hostile plane is inside its radius, it fires one
interceptor, which **always destroys one plane** (no dice — like OpenFront's SAMs). Each
plane is targeted by one interceptor only, so overlapping SAMs add interceptors, not
multipliers. A transport plane shot down loses its share of the troops. Escort fighters
are targeted first. "Hostile" = a SAM owned by someone who isn't the flight owner's
friend; flights crossing a third player's SAM coverage are shot at too (airspace matters).
Counters to SAMs: send more planes than they have interceptors, wait for the reload, strike
the SAM first, fly around its ring.

| Level | Airport name | Range | Lift capacity | Cooldown | New ability |
|---|---|---|---|---|---|
| I | Airport | 250 km | 10% of your troop capacity | 30 s | **Airlift**: send troops (current send %, capped) to any land of an ally or teammate in range. On arrival they join the friend's home troops; what doesn't fit under their capacity flies back |
| II | Military Airport | 300 km | 15% | 25 s | **Airborne assault**: land troops on hostile land in range; the landing tile is taken and a normal directed attack starts from it (the same beachhead attack as boats, 2.7). Airborne troops lose ×1.25 per tile (light infantry). The landing pocket can't be encircled while its attack advances; once it stops, it can |
| III | Air Base | 350 km | 20% | 20 s | **Air strike** (fighter wing, own 30 s cooldown) on a building (−1 level, disabled 20 s, if at least 2 fighters arrive; 1 fighter: disabled only) or on a point (**suppression** for 30 s in 10 km: fortification off, attackers lose ×0.8 there). Transports get **2 escort fighters** that absorb the first interceptors |

Why the airlift/assault capacity is a share of *your* capacity (shown as a number on the
card, e.g. "Capacity 84K troops"): fixed numbers would be huge for a 126-player lobby and
tiny for a late 8-player empire. Why airborne troops are weaker: an airdrop must stay a
surprise or a second front, not a better ground attack.

| Level | SAM name | Radius | Interceptors | Reload (each) | New ability |
|---|---|---|---|---|---|
| I | SAM Site | 25 km | 1 | 10 s | shoots aircraft |
| II | Advanced SAM Site | 35 km | 2 | 8 s | also intercepts **conventional missiles** |
| III | Integrated Air Defense | 45 km | 3 | 6 s | also intercepts the **strategic warhead**; **early warning**: flights launched within 2× its radius are announced at once |

Selecting a SAM (or hovering one in build mode) shows its radius; a "air defense" view
toggle shows all your coverage (and enemies' known SAM rings) at once.

*As built (2B.2):* **SAM I–III** (80k / +180k / +400k; 10 / 15 / 25 s; any land of yours) with
the table's radius, interceptors and reload. Each tick, before flights arrive, every flight is
checked against the SAMs of everyone who isn't its owner's friend (the target's and any third
player's: airspace matters): a working SAM with a ready interceptor whose radius holds the
flight's position fires one, which destroys one plane and the troops aboard it. A SAM fires at
most once a tick, an interceptor never wastes itself on a plane already down, so overlapping
SAMs add shots, never multipliers, and four transports against three interceptors still land
one plane. A SAM being upgraded keeps firing at its old level; a captured SAM changes sides like
any building. **Missile interception (II) and the warhead + early warning (III) come with
missiles (2B.5)** — the upgrade preview says "Later:" so nobody pays for them now. **On screen:**
the SAM card shows its interceptors (filled = ready) and when the next is back, and its radius on
the map with the ready interceptors as marks on the rim; **V** (or the ◎ button at the end of
the build bar) is the air defence view — every SAM's ring, yours light, friends' blue, others'
red; placing a SAM shows its 25 km reach; aiming an airlift shows the hostile rings and warns
"⚠ SAMs: 2 of 4 planes shot down" (or "all 4") with the interceptors ready now. Each shot is a
short streak from the SAM and a puff where the plane was; toasts tell you when your planes are
shot down (and the troops lost) and when your SAM hits. **Nations** build SAMs only under an
air threat — an Airport of a non-friend that can reach their Housing, Factories or Airports —
placed among those buildings (at most two, upgraded when worth it), and route airlifts around
hostile SAMs (or not at all when every route would lose every plane).

*As built (2B.3):* **Military Airport** (Airport II: +300k, 20 s): lifts grow to 15% of your
troop capacity, range 300 km, ready every 25 s — and its card gains **"🪂 Airborne assault —
up to N"**. Click it, then an enemy's land within the ring: four helicopters fly the send %
of your home troops (capped like an airlift) and, over the target, the troops land as a
**beachhead attack** from that tile — exactly the boats' landing (§3.18): it takes the tile,
spreads from it like any attack, never merges with your land army, and its pocket can't be
encircled while it advances (once it stops, it can). Airborne troops pay **×1.25** losses
per tile. If the tile became yours meanwhile, the troops just come home; a friend's, they
fly back. Airlifts and assaults share the Airport's cooldown. Not allowed: your own,
teammates', allies' or neutral land, sea, and spawn-protected players. SAMs shoot assault
helicopters like any plane, and **Fortress Wall flak** (§3.17.6) takes one helicopter per
wall line crossed. On screen: the aiming line and "🪂 troops · s" (red with the reason
where it can't go), the SAM warning as for airlifts, helicopters (the icon pack's, by the
Airport's era) on the map, the incoming-threat chip and horn for whoever is targeted
("X's airborne assault is heading for your land", "X's airborne troops landed on your
land"), "🪂 Assault landed: N troops attack X" for you, 🪂 on airborne armies' chips.
**Nations:** with a ready Military Airport they also look for a target by air — an enemy
nation or human they don't border, or one behind walls — using the attack estimate with
the airborne losses, the lift's cap and the planes the SAMs on the route would shoot down,
preferring enemies busy elsewhere or depleted; it competes with the best land target and
wins only when it scores higher (a landing behind the lines weighs 0.6 of a land war). They
land at the heart of the enemy's land (their start) when it is in range, or, for an enemy
across the sea, on the quietest coast in range. They invest in an Airport and its upgrade
only while such an enemy is weak enough that one lift would pay off — a late investment
that loses to every economy building per gold. In headless games (same settings as 2B.2)
assaults appear where they belong — on Islands (0.7 a game, ~1,350 tiles taken by landed
armies; median length 21.9 min vs 20.4, and no game over 30 min vs 2 of 30) — and not on
the Continent, where nations reach an Airport only in the last minute of a game; team
games are unchanged (Two lands 6.4 min median). No "teleport army": a lift of 15% of
capacity at ×1.25 losses only beats a busy or depleted enemy.

*As built (2B.4):* **Air Base** (Airport III: +700k, 25 s): lifts 20% of your troop capacity,
range 350 km, lifts ready every 20 s, and every lift and assault flies with **2 escort
fighters** — SAMs and flak shoot the escorts first, so they shield the planes and their troops
(two small fighters beside the lift on the map; "an escort fighter" in the toasts). Its card
gains **"💥 Air strike"** on its own 30 s cooldown: four fighters (3 tiles/tick; the icon
pack's plane art, which is a fighter of each era) to an enemy's tile in range — the aim snaps
onto a building icon under the mouse. **On a building:** if at least 2 fighters get through it
loses a level (a level-I building, or one still being built, is destroyed; an upgrade under way
is lost) and either way it is **out of action for 20 s** — no bonuses, a SAM doesn't fire, an
Airport flies nothing, a Port adds no boat speed or slots and sends no trade ship (dimmed badge
with 💥 and an orange ring running down; "Out of action after an air strike — N s" on its
card). **On open land:** that player's land within 10 km is **suppressed for 30 s** — walls
hold nothing and cost nothing extra to break, flak is silent, and attacks there pay ×0.8 the
losses (an orange hatched circle with its countdown, visible to everyone). Only the struck
player's land counts, only while they hold it. The aiming label says what will happen
("💥 Industrial Complex → level I · 10 s", "destroy Housing", "out of action 20 s" when SAMs
leave only one fighter, "suppress 10 km for 30 s") with the usual SAM warning. Strikes cost
nothing but their cooldown. Toasts tell the striker and the victim. **Nations** with a ready
Air Base always strike their best target: SAMs (×2) and Airports (×1.5) of any non-friend in
reach (half value when not at war), any building of an enemy they are at war with (the gold of
the level it would lose), or the walls in front of their army (suppression, worth the walls'
gold) — never a route where the SAMs would down every fighter; at least 30k gold of value. The
Air Base is valued at 0.5 × capacity while enemy buildings stand in reach, but costs a nation
~1.05M with escalation, so only late leaders reach it: 0.2 Air Bases and ~1 strike per Islands
game (headless), game lengths unchanged. Combined arms (a sim test): strike the SAM, suppress
the Fortress Wall, and the assault lands whole and takes the land. **Since the 2B.4 playtest
(D-029):** a landed army no longer cancels against a counter-attack (see §3.18).

#### 3.17.8 Missile Silo

> **D-033 (after the Phase 2B playtest, 2026-10-16).** The user: "Missiles need to do splash
> damage maybe this comes with the bunker buster. Clicking on the missile silo to access a
> missile launch isn't efficient … a button once the missile silo is placed to easily send
> missiles out fast. Missiles need to move faster in the air." Now: missiles fly **60 km/s**
> (6 tiles a tick, was 3 — the whole map in ~18 s, still time for SAMs); the strike missile
> burns a **4 km crater** and the bunker buster hits everything within **4 km** for a level
> (table below); and once you own a Silo the command bar shows a **launcher** — one button
> per missile your Silos can fire with how many are ready (🚀 Missile **R**, 🎯 Buster **T**,
> ☢ Warhead **X**). A click or the key aims it; every click on enemy land then fires one from
> the nearest Silo that can reach it and has one ready, and aiming goes on while any are
> left (the same key, Esc or right-click stop it). The aiming preview draws the crater (red)
> inside the blast (orange) and says what it burns ("crater: 49 tiles burned · 2 buildings −2
> levels · …"); the blast ring on impact matches (a buster's: its 4 km splash). Toasts: "🚀
> Your strike missile hit 2 buildings · 49 tiles of land burned · 56.8K troops killed".
> Nations count the crater's troops and the buster's splash in a missile's value.

| Level | Name | Missile slots | Reload | Range | Launch cost | New ability |
|---|---|---|---|---|---|---|
| I | Missile Silo | 1 | 30 s | 250 km | 75k | **Strike missile**: at the target, every enemy building within 8 km loses **two** levels (I–II destroyed; since D-032 — was one), the rest are out of action 60 s, fortification there is suppressed for 30 s, and **10% of the victim's home troops die** (D-032); since D-033 it also blasts a **4 km crater**: that enemy land becomes neutral for 30 s at 3× the expansion cost (the tiles of buildings still standing are spared), its owners losing home troops in proportion |
| II | Advanced Silo | 2 | 25 s | 400 km | 75k | **Bunker buster**: the building at the exact target is **destroyed** (since D-032 — was two levels), every other enemy building within **4 km loses a level** (its splash, D-033), and 5% of its owner's home troops die; slots let you fire two at once (saturates SAMs) |
| III | Strategic Missile Complex | 3 | 20 s | whole map | 75k / **500k** | **Strategic warhead** (own 90 s cooldown): 20 km radius — land becomes neutral *scorched* land (3× expansion cost for 60 s), buildings destroyed, owner loses home troops in proportion to land lost. Breaks an alliance if it hits the ally (like OpenFront). Only SAM III can intercept it |

*As built (2B.5):* the table as written, with these details decided while building it (D-030).
**Missile Silo** (250k / +400k / +800k; 15 / 20 / 30 s; any land of yours; destroyed when
captured). Its card shows its missiles (filled = ready, "next in N s") and a button per missile
it can fire, with its price. Missiles fly at 3 km/s as one "plane", visible to everyone with
their ETA, the second sheet's art turned to their heading (strike missiles in the Silo's era,
the bunker buster the air-to-ground missile, the warhead the ICBM). Firing spends one missile;
they reload one at a time (30 / 25 / 20 s). **Strike missile** (75k): every enemy building
within 8 km of the target loses a level (level I or unfinished: destroyed) and is out of action
20 s; the target player's land within 8 km is suppressed for 30 s like an air strike's point —
your own and your friends' buildings are never hit. **Bunker buster** (II, 75k): the enemy
building on the tile loses two levels (and is out of action 20 s); it must be aimed at a
building. **Strategic warhead** (III, 500k, its own 90 s cooldown, the whole map): every land
tile within 20 km that isn't yours or a teammate's becomes neutral; buildings there are
destroyed; each owner loses that share of their home troops (20% of their land → 20% of their
home troops); for 60 s expanding into that land costs 3× (a charred circle with its
countdown). Hitting an ally's land breaks the alliance — you are the traitor. You aim at an
enemy's tile (not neutral land, not a friend's). **Interception:** SAM II and III shoot down
conventional missiles, only SAM III the warhead, one interceptor per missile — so a Silo II/III
can fire several at once to get one through (saturation). Flak doesn't touch missiles. **Early
warning (SAM III):** every hostile launch within 90 km of your working SAM III appears in your
incoming list (and sounds the horn, as rate-limited as any flight), wherever it is aimed; a
warhead whose 20 km blast would reach your land counts as incoming even if aimed next door.
**War production (Factory III):** your Airports and Silos within 60 km of a working Mega
Industrial Complex reload and cool down 25% faster. **Aiming:** "🚀 2 buildings −1 level ·
suppress 8 km for 30 s · 75K gold · 8 s" with the 8 km circle (a bunker buster: "Metropolis →
level I"; the warhead: "☢ scorch 1,257 tiles of land" with a red 20 km circle and "⚠ hits an
ally's land: your alliance breaks"), "⚠ SAMs on the route would shoot it down", and only the
SAMs that can stop that missile are ringed. **Explosions (the user's request during 2B.5):**
everything that blows up — a plane or missile shot down, an air strike landing, a building hit,
a missile's or a warhead's blast — throws out sparks, fire, smoke and debris, scaled to its size
(the warhead's fills its 20 km circle). Toasts: one per missile ("🚀 Your strike missile hit 2
buildings: −1 level each", "🚀 X's strike missile hit 1 of your buildings"), "💥 X's SAM shot
down your strike missile", and a warhead is news for everyone ("☢ X's strategic warhead struck
Y"; the victim: "… scorched 1,257 tiles of your land (−12K troops)"). **Nations:** a Silo is
worth `siloWorth` 0.4 × capacity for the whole ladder (each level its share of the price, level
III double while a runaway leader stands) while an enemy nation or human has buildings within
250 km of their land; one Silo. They fire a strike missile or bunker buster at an enemy they are
at war with when the levels it would cost are worth twice the price, one more missile than the
SAM II+ interceptors on the route, and the warhead only at a **runaway
leader** (a non-friend holding a third of all owned land), where it scorches the most of the
leader's land, never on an ally's land and never into a SAM III. A hostile Silo in reach counts
as an air threat for their SAMs. In headless games (30 Islands games, 8 nations) Silos
appear only in long games: 0.9 a game, ~2 missiles, one warhead in 30 games, median length
22.7 min (23.0 before); none on the Continent (9.0 min) or in team games (5.0 min).

**After the 2B.6 playtest (2026-10-15, D-032).** The user: "Missiles should destroy bases or
suppress them. Missile attacks kill population too. Bots don't use missiles." So: a strike
missile costs every enemy building within 8 km **two levels** (levels I–II are destroyed),
puts the survivors out of action for **60 s** (was 20 s), still suppresses the land for 30 s,
and kills **10%** of the target player's home troops; a bunker buster **destroys** its
building outright (three levels) and kills 5% of the owner's home troops. The aiming label
says it ("🚀 2 buildings −2 levels · 10% of their troops · suppress 8 km for 30 s"), and so do
the toasts ("🚀 Your strike missile hit 1 building: −2 levels each · 60.9K troops killed").
Nations count the troops a missile kills (a gold a troop) and fire when the damage is worth
**1.2×** the price (was 2×); a Silo is worth 0.6 × capacity to them (was 0.4). Islands at
Medium: 4 missiles and 1.7 Silos a game (0.7 and 1.1 before).

#### 3.17.9 Housing, Factory, Port

- **Housing** — troop capacity (the gold → army engine, OpenFront's City). A fixed bonus,
  so a small player gains proportionally more (anti-snowball, like OpenFront).
- **Factory** — gold income and cheaper Mobilize (OpenFront's trains are replaced by a
  plain income number; the user's "military production" is the Mobilize discount and, at
  level III, faster reloads for nearby airports and silos — built in 2B.5).
- **Port** ✅ I–III (2.7, 2B.6, §3.18) — boats launch from *any* coast; a Port makes them
  better. Level III, the Naval Base, keeps two warships patrolling its sea and fortifies its
  coast like a Stone Wall (§3.18.1, D-031).

#### 3.17.10 The 21-tier matrix (proposed starting numbers)

Costs are before the +25%-per-level-owned escalation. "Total" = build + upgrades.
Speeds/ranges in tiles (= km). Cooldowns in seconds of game time.

| Building | Lvl | Build / upgrade cost (total) | Time | Benefit | New ability | Range | Capacity | Cooldown | Countered by | Looks like |
|---|---|---|---|---|---|---|---|---|---|---|
| Housing ✅ | I | 40k (40k) | 5 s | +75k troop capacity (30k until D-033) | — | — | — | — | capture (−1 lvl), strike, missile | one house, 1 pip |
| Housing ✅ | II Developed Housing | +90k (130k) | 10 s | +225k capacity (90k) | +5% troop growth (all buildings together max +20%) | — | — | — | same | two houses, 2 pips |
| Housing ✅ | III Metropolis | +220k (350k) | 20 s | +625k capacity (250k), +10% growth | +20 gold/tick | — | — | — | same — a prime target | a tower between houses, 3 pips |
| Factory ✅ | I | 60k (60k) | 5 s | +30 gold/tick (300/s) | — | — | — | — | capture, strike, missile | hall + one chimney |
| Factory ✅ | II Industrial Complex | +120k (180k) | 10 s | +100 gold/tick (90 and Mobilize −10% until D-033) | — | — | — | — | same | hall + two chimneys |
| Factory ✅ | III Mega Industrial Complex | +280k (460k) | 20 s | +250 gold/tick (220 and Mobilize −20% until D-033) | **War production** ✅ (2B.5): airports & silos within 60 km reload 25% faster | 60 | — | — | same — a prime target | hall + three chimneys |
| Port ✅ | I | 50k (50k) | 10 s | boats from within 30 km of it 1.5× faster; +1 boat at a time; +15 gold/tick | — | 30 | +1 boat | — | capture, strike, missile, warships (later) | small pier |
| Port ✅ | II Naval Port | +120k (170k) | 15 s | boats 2× faster; +1 more boat; +40 gold/tick | **Marines**: landings from it lose ×0.8 per tile | 30 | +2 boats | — | same | pier + crane |
| Port ✅ | III Naval Base | +300k (470k) | 20 s | boats ×2, +2 boats, Marines; +25 gold/tick, a trade ship every 7 s (§3.19) | **Coastal fortification** ✅ (its owner's coast within 30 km counts as a Stone Wall) and a **warship patrol** ✅ (2 warships within 40 km, §3.18.1) | 30 / 40 | +2 boats | rebuild 60 s | strike, missile, enemy warships, airborne behind the coast | the pack's Modern port |
| Wall ✅ (D-024) | I Palisade | 600/tile | 4 s + 0.1 s/tile | wall tiles hold 3 s, ×3 + 150 losses | drawn A, B, C … anywhere on your land | — | ≤ 80 tiles | — | go around, break through (a gap), airborne, strike, missile | brown stakes |
| Wall ✅ | II Stone Wall | +1,500/tile | 8 s + 0.1 s/tile | 6 s, ×5 + 500 | — | — | — | — | same | grey blocks, towers |
| Wall ✅ | III Fortress Wall | +4,000/tile | 15 s + 0.2 s/tile | 10 s, ×8 + 1,500 | **Flak** ✅ (2B.3: one plane per hostile flight that flies within 3 km) | — | — | — | same | thick stone, merlons, big towers |
| SAM ✅ | I SAM Site | 80k (80k) | 10 s | shoots hostile aircraft | — | 25 | 1 interceptor | 10 | saturation, strikes, flying around | single launcher, dish |
| SAM ✅ | II Advanced SAM Site | +180k (260k) | 15 s | 2 interceptors | intercepts conventional missiles ✅ (2B.5) | 35 | 2 | 8 | same | twin launcher + radar |
| SAM ✅ | III Integrated Air Defense | +400k (660k) | 25 s | 3 interceptors | intercepts the strategic warhead; early warning ✅ (2B.5) | 45 | 3 | 6 | same, bunker busters | launcher array, rotating radar |
| Missile Silo ✅ | I | 250k (250k) | 15 s | strike missile (75k per launch) | — | 250 | 1 slot | 30 | SAM II+, capture (destroyed) | hatch in the ground |
| Missile Silo ✅ | II Advanced Silo | +400k (650k) | 20 s | 2 slots | bunker buster | 400 | 2 | 25 | SAM II+ | two hatches |
| Missile Silo ✅ | III Strategic Missile Complex | +800k (1.45M) | 30 s | 3 slots | **strategic warhead** (500k, 90 s) | map | 3 | 20 / 90 | SAM III only | three hatches, warning stripes |
| Airport ✅ | I | 120k (120k) | 15 s | airlift to friends | — | 250 | 10% of capacity | 30 | hostile SAMs on the route, capture | short runway, small terminal, transport plane |
| Airport ✅ | II Military Airport | +300k (420k) | 20 s | bigger, longer lifts | **airborne assault** | 300 | 15% | 25 | SAMs, Fortress Wall flak, encirclement of the landing once it stalls | longer runway, hangars |
| Airport ✅ | III Air Base | +700k (1.12M) | 25 s | escorts | **air strike** (fighters) | 350 | 20% | 20 (lift) / 30 (strike) | SAMs (saturated by numbers), strikes back | runway pair, tower, fighters |

**Visual progression.** Every building is one original icon with three drawings of growing
detail and **1–3 level pips** under it; the tier reads without clicking. *As built (2.5
playtest revamp):* the drawings are SVG paths in `client/icons.ts` shared by the map and
the HUD — Housing: a house → a street of two → a skyline with a tower; Factory: a
saw-tooth workshop with one chimney → two chimneys and smoke → a wider plant with three.
On the map they sit in a round dark badge ringed in the owner's colour, gold dots for the
level, a gold outer ring at level III; 18–40 px depending on zoom. *Since 2B.0b (D-028):*
the drawings are replaced by the user's painted isometric icon pack — eras WW1 → WW2 →
Modern for levels I → III (`client/sprites.ts`), 18–48 px; troop boats, trade ships and
planes use the pack too, on an owner-coloured oval or shadow, mirrored by heading; walls
keep their drawings until art in the same style exists. Construction:
the icon fills in from the bottom with a thin progress ring; upgrade: a brief scaffold
outline, then a soft pulse as the new icon and (if any) the larger range ring appear.
Zoomed far out, other players' level I–II buildings shrink to small dots ringed in their
colour (2.6 fix: hiding them made nations look like they only built walls); your own and
level-III buildings keep their icon.

**As built in milestone 2.5 (Housing, Factory — rows marked ✅).** The first measurement
showed nations never upgrading: level I gave the most per gold. Re-priced so every level
step returns about as much per gold as the one below (Housing step II +60k capacity for
90k, step III +160k for 220k; Factory each step pays back in ~3.5 min), plus its new
ability. Other details decided while building: buildings are placed from the right-click
menu at first — replaced after the playtest by the build bar with a building that follows
the mouse (§3.17.13); captured buildings are adopted at their level (user); a building
captured by a **tribe** is destroyed (tribes never keep buildings, like OpenFront's); the growth cap (+20%) counts all
buildings; troop gifts need a shared border (D-023). **Nation AI:** a nation weighs every
option — a new Housing or Factory (one building per 4,000 tiles) and the next level of each
building — by value per gold (capacity 1 per troop, growth bonus over 1 min of peak growth,
gold over 2.5 min of income — and, until D-033, a Mobilize discount), aims
at the best one it can afford within 2 min of income, keeps part of that price out of its
war chest while saving (turtles 100%, expanders 80%, opportunists 60%, aggressors 40%),
and builds once it can pay — in peacetime, one construction at a time, deep inside its
land. Results: ROADMAP milestone 2.5.

#### 3.17.11 Counters at a glance

```
Walls ──────────strong vs──▶ ground attacks
      ▲                             │
  bypassed by                  bypassed by
Airborne (Airport II) ◀──shot by── SAM ◀──struck by── Air strike (Airport III)
      │                             ▲                      │
      └──── Port (boats) ── bypasses land borders          │
Missile (Silo) ──hits──▶ any building, suppresses lines; SAM II+ intercepts (III: warheads)
Housing / Factory / Airport / Silo ──are── prime targets for strikes, missiles, capture
```

No rock-paper-scissors table to memorise: every counter is "go around it, overwhelm it,
or hit the building that makes it".

#### 3.17.12 Economy fit — when can a player afford what?

Our income (§3.16): 10 + 0.8·√tiles gold per tick. Measured median nation income (8-nation
games, ROADMAP 2.4): ~1.0k gold/s at minute 1, ~2.0k at minute 3, ~3.1k at minute 6; tribe
lobbies ~20–30% less. Rough gold earned so far (if nothing is spent): **~40k by 1:00,
~200k by 3:00, ~650k by 6:00, ~1.4M by 10:00** — and every coin can instead buy a troop.

| Milestone in a game | Proposed price | Affordable around | Notes |
|---|---|---|---|
| First L1 (a wall / Housing) | 20–40k | **1:00–1:30** | common, early |
| First L2 upgrade | +80–150k | **3:00–4:00** | a real choice against Mobilize/war chest |
| First L3 upgrade (Metropolis) | 390k total | **6:00–7:00** | a major asset |
| Airport III | 1.12M total | **9:00–10:00**, leaders only | only in longer games |
| Missile Silo III | 1.45M total | **10:00–12:00**, top 1–2 players | late-game strategic asset |

Compared with OpenFront (flat 1,000 gold/s; first city 125k ≈ 2 min of income; games
20–40 min), our prices are about a third, because our games are about a third as long.
**The tension:** today's median game (7–13 min) ends before most players reach L3 airports
or silos. **The user accepts longer games (2026-10-02).** Provisional target, to confirm in
the 2.10 and 2B playtests: a typical lobby (nations + tribes) runs a median **~15–20 min**,
so a normal game reaches its first L3 buildings and the leaders reach L3 airports or silos.
Buildings will lengthen games by themselves (stronger defence); if that isn't enough we
tune the game's pace (crush curve, win share) rather than make L3 cheaper.

#### 3.17.13 UI/UX

- **Keys and badges (D-033, the user after the Phase 2B playtest):** keys **1–7** pick up the
  build bar's buildings in order — 1 Housing, 2 Factory, 3 Port, 4 Airport, 5 SAM, 6 Silo, 7
  Wall (the attack presets moved to Shift+1–5); each tile shows its key, keeps its name on
  one line ("SAM", "Silo": two-line names spilled out of the 36 px box) and the row wraps on
  a narrow screen instead of spilling out of the bar. "Icons do not feel clear enough of what
  they actually are": every type has a **colour and a bold symbol** — Housing green ⌂,
  Factory amber (sawtooth roof), Port blue ⚓, Airport purple ✈, SAM teal (shield), Silo red
  (rocket), Wall grey (battlements) — drawn as a small disc on the icon's upper left on the
  map, in the build bar and on the card. **Zoomed out**, other players' level I–II buildings
  are dots filled with their type's colour, ringed in the owner's, with **one white pip per
  level** under them ("level dots when zoomed out").
- **Build (as built after the 2.5 playtest):** a **build bar** in the bottom command bar —
  one tile per building with its icon and price (red when you can't afford it). Click a
  tile and the building sticks to the mouse (snapped to the tile under it, with its
  spacing ring green or red, plus zone/range rings later); click your land to place it,
  right-click or Esc to put it back (OpenFront's way). The first version (a *Build here*
  list in the right-click menu, key B) was dropped: the user didn't like it.
- **Walls (2.6):** the bar's last tile is *Wall* (price per tile). Click points A, B, C …
  on your land; the line follows the mouse, green or red, with length and price; right-click,
  Enter or clicking the last point again builds it, Esc cancels. Click one of your walls for
  its card (length, effect, Upgrade / Cancel).
- **Building card** (click a building — small glass card next to it, closes with Esc or a
  click on the map):

```
╭─────────────────────────────────────╮
│ ✈  AIRPORT              ▮▮▯  Level 2 │
│ Military Airport                     │
│ Range 300 km · Capacity 84K troops   │
│ Ready ✓            (or "Ready in 0:12")
│ [ Airlift ]  [ Airborne assault ]    │
│─────────────────────────────────────│
│ Upgrade to Air Base      $1.05M  ▶  │
│ + Air strikes · Escorts · 350 km     │
╰─────────────────────────────────────╯
```

- **Actions** (airlift, assault, strike, missile): click the action → the range ring
  shows, valid targets brighten, the hover card previews the outcome (troops sent with the
  current send %, ETA, SAM interceptors on the route) → click a target. One click to
  confirm; Esc cancels. Commitment always uses the existing send % control.
- **On the map:** flights as small aircraft/missile glyphs on a faint dotted route with
  an ETA; incoming hostile flights also get a coral chip like incoming attacks ("Airborne
  assault from X · 0:09"); SAM shots as a short streak and a puff; walls drawn as thick lines
  by level (stakes, blocks, merlons and towers); suppressed zones briefly hatched.
- **Upgrade feedback:** the icon changes, pips fill, a soft pulse, the range ring grows
  once, a toast "Air Base ready — air strikes unlocked". No big animations.

### 3.18 Boats & Ports (milestone 2.7 · as built · D-025)

Boats carry troops across the sea and land them as an attack on the far coast — the way to
reach islands, and a way around fronts and walls. Like OpenFront: any coast will do, no
Port needed; Ports make boats better.

**Sending a boat.** Click land you can't reach over your own border — land on another
landmass, or a player you don't border — and a boat goes instead of an attack (the hover
card says "Click: ⛵ boat with N · lands in X s", a dashed route with a landing ring shows
on the map). The right-click menu offers "⛵ Boat with N%" for any coastal target, even one
you border by land. The boat carries the current send % of your home troops.

| Rule | Value / behaviour | Why |
|---|---|---|
| Landing | the target's coast tile nearest the click (searched up to 60 tiles around it); neutral land too (settling an island) | Click where you want to land |
| Launch | your coast tile on the same sea that lands soonest: the nearest one, or a Port's tile if its speed makes it sooner | Any coast works; Ports matter |
| Route | shortest path over sea tiles, 8 directions, never cutting a corner of land; found once at launch (deterministic A*, gives up after 600k sea tiles: "no sea route") | Visible, predictable, cheap |
| Speed | 1 sea tile per tick = 10 tiles/s (a 100-tile crossing takes 10 s); ×1.5 from a Port I, ×2 from a Naval Port within 30 tiles of the launch | Long enough to see coming, short enough to matter |
| Boats at sea | 3 at once; +1 per Port I, +2 per Naval Port; at most 6 | OpenFront's 3; Ports raise it |
| Troops aboard | count toward your capacity (like an army in the field) | D-011: no stockpiling at sea |
| Landing | a **beachhead attack**: it takes the landing tile (paying the normal cost) and spreads from it toward the click; it never merges with your land army against the same player | OpenFront's boat attacks don't merge either; airborne assaults (2B) reuse it |
| Landing pocket | can't be encircled while its attack advances; once it stops (spent, retreated, done) it can | A landing isn't wiped out by the encirclement rule the moment it lands |
| Counter-attacks | a landed army never collides with the defender's attack (land armies do): the defender has to take the pocket tile by tile while the landed army keeps advancing (D-029, the user after the 2B.4 playtest) | A counter anywhere used to cancel the landed army at once, and its pocket was then annexed |
| Landed on friendly land | if the landing tile became yours or a friend's meanwhile, the troops go home | Never attack a friend by accident (an OpenFront bug) |
| Recall | the boat turns around; troops come home when it is back (no loss) | A changed mind costs time, not troops |
| Owner eliminated | their boats sink | — |
| Marines (Naval Port) | landings launched within its range pay ×0.8 losses per tile | Level II's new ability (§3.17.10) |

**Ports (I–II).** Built on a coast tile (the ghost is red inland). Port I: 50k, 10 s, +15
gold/tick, boats ×1.5, +1 boat. Naval Port: +120k, 15 s, +40 gold/tick, boats ×2, +2 boats,
Marines. The best Port in range counts (speeds don't stack). Captured Ports are adopted
like any building. Level III (Naval Base) comes with Phase 2B. A game without boats offers
no Ports.

**Warnings.** A boat sailing for your coast: a red toast "⛵ X's boat is heading for your
coast", a red chip counting down "X's boat lands in N s", and its route drawn in red to a red
landing ring. A landing: "X landed on your coast". Your own boats: a chip "⛵ To X · troops
· Lands in N s" with a Recall button (↩); beachhead armies show ⛵ in their chips.

**Nations.** A nation with no open land next to it sails for the nearest unclaimed coast
within 300 tiles (one settling boat at a time). One that finds no land target worth it
looks across the sea for a player it can beat (the same estimate as on land, weighed ×0.7
for the crossing) and lands on their coast nearest it (one attacking boat at a time); it
mobilizes before a boat attack like before a land attack. Nations build one Port (valued
for its income plus 0.2 × capacity per unit of boat speed) and upgrade it. Tribes stay on
land.

#### 3.18.1 Naval Base & warships (milestone 2B.6 · as built · D-031)

Port level III. The user's choices at the 2B.6 start (2026-10-14): warships patrol on their
own — **changed after the user played 2B.6 (2026-10-15, D-032): you can click your warship and
then the sea to send it anywhere on its sea** (it patrols and fights there; left alone it
guards its Base); they attack
**troop boats, warships and trade ships** of players who aren't their owner's friends
(OpenFront's order); the art is the user's to make from a prompt I wrote
(`docs/art/WARSHIP_ART_PROMPT.md`) — until it arrives the map draws the Modern troop boat in
grey, and the Port card says so.

| Rule | Value | Why |
|---|---|---|
| Naval Base | Port III: +300k, 20 s; boats ×2, +2 boats, Marines (as the Naval Port), +25 gold/tick, a trade ship every 7 s | The last naval step; dearer than any economy upgrade |
| Fleet | **2 warships** per Naval Base, launched the moment it is finished | One patrol to each side of the Base |
| Patrol | each warship sails from one random point of its Base's sea within **40 km** to the next — always **open water, 4 km or more from land** (D-032: "too close to shore") | Guards the water around the coast, not the whole ocean |
| Orders (D-032) | **click your warship, then the sea**: it sails there (firing at hostiles within gun range on the way, chasing nothing), then patrols and fights within **15 km** of that spot until sent elsewhere; Esc / right-click cancels the selection. The selected ship is ringed white with its route and patrol circle; an ⚓ marks where each of yours was sent | The user after playing 2B.6: "warships need to be controlled by players" |
| Targets | ships of players who are **not friends** of the owner (allies and teammates are safe) inside the patrol area: **troop boats first, then warships, then trade ships** — the nearest of the most urgent kind | A Base defends its coast first |
| Peaceful trade | a trade ship **bound for a Port of the owner's or a friend's** is left alone — it comes to trade | Headless: seizing one's own trading partners took ~180 ships a game and starved everyone's trade (decided in 2B.6) |
| Guns | within **8 km** the warship stops and fires once every **2 s**: one shell **sinks a troop boat** (everyone aboard is lost) or takes 250 of a warship's 1,000 health (four shells sink it) | A Base turns back a stream of small landings, not a fleet launched at once |
| Capture | a trade ship within 8 km is boarded instead: it sails on (a new ship) for the captor's nearest working Port and **its cargo goes to that Port's owner**; with no such Port it is sunk. A prize can't be taken again | D-026: piracy pays |
| Speed | 1.5 km per tick (15 km/s): faster than trade ships and Port I boats, as fast as a Naval Port's | They catch what sails through |
| Sunk | rebuilt at its Base after **60 s** (only while the Base works); mends 2 health a tick while it has nothing to shoot | Losing a ship costs time, not gold |
| Base captured | its warships are scuttled; the new owner's are built after 60 s. Base destroyed or down to level II (strikes, missiles): the warships are gone | Warships belong to their Base |
| Coastal fortification | the owner's **coast within 30 km** of a working Naval Base counts as a **Stone Wall** (holds 6 s, ×5 losses + 500 troops a tile) — for landings and land attacks along that shore alike; drawn as a grey stone line on the coast | "A coast that is hard to land on" — the design's level III ability |
| Spawn protection | warships don't fire | Like everything else |

**Seen on the map.** Warships in the owner's colour like boats, bigger, with a health bar
once damaged; a shell is a streak with a splash (a fireball when it sinks something). Toasts:
"⚓ X's warship sank your boat — N troops lost", "⚓ Your warship captured X's trade ship —
N gold aboard", "⚓ X sank your warship — a new one is being built" (and the matching good
news). No new sounds (the user's preference: alerts stay rare). The Naval Base card lists
"Warships: 2 of 2 at sea" and when the next one is ready.

**Nations (warship orders, D-032).** At war with someone who has a Port on the same sea, a nation
sends its oldest warship to blockade the enemy Port nearest its Base (open water just off it);
the other stays home; when the war ends, the blockader comes home.

**Nations.** They value the Naval Base upgrade at its income and trade plus **0.15 ×
capacity** while an unfriendly Port shares its sea, and keep their troop boats out of
waters a non-friend's warships guard (its patrol area plus gun range) — so in bot games
warships mostly deter: nations land elsewhere.

### 3.19 Trade ships (milestone 2.8 · the user's request at the 2.8 start)

The user, after playing boats: *"we need ports to bring in income. Little ships should be
around the map that is considered trade and go to other nations and players ports … exactly
how OpenFront is."* Warships that capture trade ships (allies immune, every other ship fair
game) come with warships in **2B.6**; trade ships are built so they can be captured later
without rework (their owner and destination can change at sea).

**How it works.** Every finished Port sends a small trade ship to another player's Port on
the same sea, picked at random, on a fixed rhythm (Port I every 20 s, Naval Port every 10 s;
each Port has its own beat so they don't all leave at once). The ship sails the sea route at
1 tile per tick (Port speed bonuses are for troop boats). When it docks, **both** owners
earn gold — the more sea it crossed, the more: 1,000 + 12 per route tile since D-033 (400 + 10 before), at most 6,000 (≈
1.4k for 100 tiles, 3.4k for 300). Allies, teammates and enemies all trade (no embargo yet).

| Rule | Value / behaviour | Why |
|---|---|---|
| Partners | any other living player's finished Port that shares a sea with yours | OpenFront: any trading partner |
| Gold per trip | each side `min(6,000, 1,000 + 12 × route tiles)` (400 + 10 until D-033: "Ports don't make enough money when receiving goods early game"), paid on docking | Long routes pay more (like OpenFront), but capped; the bigger base pays the short routes of the early game |
| Rhythm | Port I one ship per 20 s, Naval Port one per 10 s | Levels matter; a typical Port I earns ~30 gold/tick from trade (≈ a Factory I), a Naval Port ~60 |
| Harbour income | the flat Port income drops to +5 / +15 gold per tick (was +15 / +40) | Trade is now where a Port's money comes from; the small flat part keeps a lone Port useful |
| Destination Port captured | the ship docks with the new owner (they earn the receiving half) — unless that's the ship's own owner (no gold) | Ports change hands; trade follows the Port |
| Destination Port destroyed, or sender eliminated | the ship is lost, no gold | — |
| At sea at once | at most 200 trade ships in the whole game (a new ship waits otherwise) | Keeps huge lobbies cheap and the sea readable |
| Seen on the map | a small hull in the owner's colour with a gold cargo dot; "+2.3k" floats up over your Port when a ship of yours docks somewhere, or someone's ship docks at yours | Trade income is visible, not a hidden number |
| HUD | the Port card shows "Trade: a ship every 20 s · N partner Ports" and the gold its trade earned so far | — |

**Nations.** They value a Port's trade at what it would earn now (partner Ports on its sea ×
the average trip), so Ports get more attractive once others have built them.
**Warships (2B.6, §3.18.1):** a Naval Base's warships capture trade ships of players who
aren't their owner's friends while they pass through its patrol area: the ship sails on for
the captor's nearest Port and its cargo goes to that Port's owner. Allies' and teammates'
ships are immune, and so is a ship bound for a Port of the warship's owner or a friend —
it comes to trade.

### 3.20 Alerts, pings & emojis (milestone 2.9 · as built · D-027)

Asked at the 2.9 start, the user chose **"alerts only"** for sound and **emojis + map
pings** for talking (no quick-chat phrases). There is still no free-text chat (moderation).

**Alert sounds.** Four short warnings, made live by the browser (Web Audio synthesis — no
audio files, nothing to license; OpenFront's sounds are all-rights-reserved, D-001). Nothing
else makes a sound. *Retuned after the user played 2.9:* "the attacks and emoji noises are
annoying because they are constant and can be spammed" → the loud attack horn and the ping
blip are gone; attacks get a subtle sound, once per attacker; the horn stays for boats
("keep boat horn"); every betrayal in the game sounds for everyone.

| Alert | When | Sound |
|---|---|---|
| Attacked | a player starts a land attack on **you** — once per attacker; the same attacker is quiet for 30 s | two soft low tones |
| Boat | a new enemy boat sets sail for your coast (once per boat; its landing makes no second sound). 2B: flights, missiles | low two-tone horn |
| Alliance | someone asks you for an alliance, or one of yours enters its renewal window | soft two-note bell |
| Betrayal | **anyone** breaks an alliance (also a toast for everyone) | three falling notes |

Pings and emojis make no sound (anyone could spam them). The same alert also plays at most
every 1.5–6 s. Volume
slider + mute in the pause menu (Esc), remembered by the browser; default 60%. Browsers
start audio only after a click or key press — the Play click does it.

**Incoming-threat warning (reusable).** One list (`client/app/threats.ts`) of everything
heading for your land — today boats, in 2B air assaults and missiles. From it: a red chip
with the countdown ("⛵ Valdorra's boat lands in 42 s"), a pulsing red ring at the landing
spot with the seconds left, an arrow at the screen edge pointing at it when it is off
screen, and the boat horn once per new boat.

**Map pings.** Right-click menu → *Ping for your allies* (🎯 Attack here · 🛡️ Defend here ·
⚠️ Watch out), or **G** for a ping under the cursor (attack on enemy land, defend on yours or
a friend's, watch out on open land or sea). Only your allies and teammates see them: a
pulsing ring in the ping's colour with the sender's dot and icon, "Name: Attack here" for
the first few seconds, an edge arrow when off screen, and a toast (no sound).

| Rule | Value | Why |
|---|---|---|
| Showing time | 10 s | long enough to read and act on |
| Cooldown | 1 s per player; at most 3 pings each on the map (the oldest goes) | no spam |
| No friends | the ping isn't sent; a toast says only allies and teammates see pings | otherwise a silent no-op |

**Emojis.** Right-click menu → a grid of 14 (👋 🤝 👍 👎 😀 😂 😢 😠 😱 💀 🎯 🙏 ❤️ 🏳️), to the
player whose land you clicked, or to everyone from your own or open land. The emoji pops
up over the sender's name for 5 s (ringed in the sender's colour when it is for you); an
emoji to you is also a toast. Cooldown 3 s. You see emojis to everyone, to you, and yours.

**Nations.** They take part (tribes don't):
- A friend's (ally's or teammate's) **"Attack here"** ping on a player makes that player
  their preferred target (score ×3, half the usual minimum gain), aimed at the pinged spot.
  A friend's **"Defend here"** makes whoever attacks that friend a preferred target (×3).
  "Watch out" is for people; nations ignore it.
- They **ping their human friends**: "Attack here" where they strike a nation or a person,
  "Defend here" at the front when attacks on them hold over 60% of their home troops — at
  most every 30 s.
- They **answer people's emojis** (60% of the time): friendly back to friendly (👋, ❤️ for a
  friend; 👎 when at war), 😂 or 😠 to rudeness (😂 if much stronger), 🤝 or 💀 to a white
  flag. They also react to a person's betrayal (😠), a new alliance (🤝) or an attack (😠 or
  😱).
- All of this involves people only, so **bots-only games are exactly as before** (measured:
  18 of 18 headless games identical to 2.8).

**Multiplayer (Phase 3).** Emojis and pings are commands like any other, validated by the
simulation; the server will forward a ping only to the pinger's friends.

---

## 4. Interaction model

### 4.1 Desktop

| Input | Action |
|---|---|
| **Left click** on neutral/enemy land you border | Attack/expand there with current % (repeat to add troops) |
| Left click on your own land | Select yourself (shows your stats card) |
| Left click during spawn phase | Choose / move spawn |
| **Right click** | Context menu for the tile/player under the cursor (attack with a preset %, cancel attacks on this player, info; later: alliance, donate, boat) |
| **Drag** (left, right or middle, > 4 px) | Pan (a drag never triggers an attack) |
| **Mouse wheel** | Zoom toward the cursor (smooth) |
| **Shift + wheel** | Adjust attack % in 5% steps |
| **1 · 2 · 3 · 4 · 5** | Attack % presets: 10 · 25 · 50 · 75 · 100 |
| **Q / E** | Attack % −5 / +5 |
| W A S D / arrows | Pan |
| **Space** | Center on my territory |
| **Esc** | Close the open menu → else open the pause menu |
| Hover enemy land | Cursor card: who it is, their troops, and a **battle preview** for your current % |

Principles: a click is never ambiguous (drag threshold), every action has a mouse path
and a keyboard path, and hovering always tells you what a click would do.

### 4.2 Mobile (Phase 4, designed now)

| Gesture | Action |
|---|---|
| Tap | Primary action (attack/expand) with a brief confirmation ring |
| Long-press | Context menu |
| Pinch | Zoom |
| One-finger drag | Pan |
| Bottom sheet | Troop bar + large attack % presets |

---

## 5. HUD & UI design

### 5.1 Layout (desktop)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● Rowan · 18.4% land · #2                 ⟨ toast ⟩                 04:12  ☰ │
│                                                            ┌──────────────┐  │
│                                                            │ 1 ● Azure 31%│  │
│                                                            │ 2 ● You   18%│  │
│                                                            │ 3 ● Ember 12%│  │
│                          ( the map — everything else )      └──────────────┘  │
│                                                                              │
│                    ╭───────────────────────────────────╮                     │
│                    │ ⚔ Ember   ▰▰▰▰▰▰▱▱  8.2K  +312 · ▲ │  ← active attacks   │
│                    ╰───────────────────────────────────╯                     │
│        ╭──────────────────────────────────────────────────────────╮          │
│        │ 24.8K ▕████████████▒▒▒▒▒▒░░░░│░░░░░░░░░▏ 61.2K   +480/s │          │
│        │ Send  [10] [25] [ 50 ] [75] [100]          12.4K troops  │          │
│        ╰──────────────────────────────────────────────────────────╯          │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Command bar (bottom center)** — the only permanent control surface:
  - **Troop bar:** home troops vs capacity; a subtle tick marks the **50% sweet spot**;
    the segment that would be sent at the current % is **hatched**, so you see where
    you'd land relative to the sweet spot *before* clicking; growth rate `+480/s`.
  - **Attack % control:** five presets (segmented control) + live troop count.
    Adjustable by click, `Shift+1–5` (numpad 1–5; plain `1–5` until D-033 gave the number
    keys to the buildings), `Q/E`, or Shift+wheel. Fill animates smoothly.
- **Active attacks (above the command bar):** one compact chip per attack — target,
  remaining army (shrinking bar), tiles taken, a qualitative **odds** label
  (*Overwhelming · Advantage · Even · Costly · Hopeless*), and × to retreat. Incoming
  attacks appear as coral chips.
- **Top-left:** a tiny "you" chip (color, name, land %, rank).
- **Top-right:** mini leaderboard (top 5 + you, collapsible), match timer, menu.
- **Top-center:** toasts — short, auto-dismissing, stack at most 3.
- **Cursor card:** contextual details on hover (player name, troops, land, relation,
  battle preview).
- **Overlays:** spawn prompt, pause menu, victory/defeat card with match stats and
  *Play again*.

**As built (milestone 1.6):**
- **Command bar:** home troops / capacity, troops in the field, growth per second; the
  troop bar shows a soft green **sweet-spot zone** (35–65%, where growth is within ~10% of
  its peak), a white **½ tick**, the **hatched slice** a click would send, and field troops
  as a faint striped segment. A status line names the state in plain words — *Low —
  rebuilding slowly · Near half — fastest growth · Above half — growth slowing · Full — not
  growing. Send troops!* — and at full capacity the whole card pulses amber. Presets
  10–100 (Shift+1–5) plus the live troop count; a non-preset value (Q/E, Shift+wheel) is
  shown next to it.
- **Odds** (`sim/battle.ts`, the same estimate the bots use): the expected share of the
  target's land an army takes — limited by Lanchester's law *and* by the per-tile cost of
  their land. *Overwhelming* = takes everything with ≥ 2× their home troops (half the
  losses, a flood) · *Advantage* = takes everything · *Even* = 40–99% · *Costly* = 10–40% ·
  *Hopeless* = under 10%. Shown on the hover card, the right-click menu and outgoing
  chips ("takes ~35% of their land"). Incoming chips show the same estimate as a
  **threat** (Critical · High · Serious · Moderate · Low).
- **Attack chips:** outgoing — target, a shrinking bar of the army left (vs its peak),
  troops, tiles taken, odds, × retreat. Incoming — coral chip with the threat and a
  **Counter** button that attacks the sender with your current % (aimed at their land
  nearest their attack): opposing armies cancel out, the cheap defence the bots use.
- **Hover card:** owner, terrain (highland/mountain warn "slower, costlier"), troops,
  land, bot personality, "Attacking you" / "You're attacking", and what a click would
  do: expand (with an upper bound of tiles) or attack (army, odds, expected outcome) — or
  why it can't (not bordering, spawn protection countdown, no troops). *D-033 (the user:
  "no hover land info needed for tribes or unclaimed land; hover information needs to be more
  clear and easy to read"):* no card over unclaimed land or a tribe's; the card has a coloured
  edge in the owner's colour, a bold name with one relation chip (Ally, Teammate, Attacking
  you, Traitor), the bot's description, labelled rows — Troops, Land, Gold, Housing — and the
  click's outcome in its own box ("CLICK attack with 38K (25%) Advantage").
- **Right-click menu:** the same preview for every preset (pick one to send it), retreat
  from that player / stop expanding. Arrow keys + Enter work; Esc or a click outside
  closes it.
- **Top right:** match clock (with a speed badge when not 1×), menu button, collapsible
  leaderboard (top 5 by land + you with your real rank, players left).
- **Toasts** (max 3, 4.5 s): attacks on you, your eliminations, other eliminations,
  encirclements of ≥ 25 tiles involving you, your attack cancelled out / ran out, match
  start, end of spawn protection. Small slivers cut off along fronts are not news.
- **Pause menu (Esc):** pauses the simulation; resume, game speed 1×/2×/4×, the controls
  list, and "Leave match" (asks for a second click).
- **Hints** (bottom left, one at a time; each disappears when done or after ~14 s for the
  explanatory ones; remembered in this browser): expand → (attack, as soon as you border
  a player after spawn protection) → sweet spot → right-click & Esc.

### 5.2 Visual language

- **Glass cards** over the map: dark translucent surface (~72% opacity) with backdrop
  blur, 1 px hairline border, 12 px radius, soft shadow. Calm, not metallic.
- **Typography:** a clean sans (Inter or system UI), tabular numerals for all counts,
  three sizes only (12 / 14 / 18) plus one display size for victory.
- **Color:** neutral grays for UI; the **player's own color** is the accent;
  semantic colors for danger (incoming), success and warning. Strict contrast (WCAG AA).
- **Motion:** 120–200 ms ease-out for hover/press; numbers tween; toasts slide/fade;
  nothing bounces. Respect `prefers-reduced-motion`.
- **Icons:** simple line icons, consistent 1.5 px stroke.

### 5.3 Territory visuals

- **Terrain:** restrained natural palette (soft greens/sands, pale highlands, light
  stone mountains) with subtle hillshade; water a calm slate-blue with depth gradient
  and soft coastlines. Terrain stays visible beneath territory because it affects
  combat.
- **Territory fill:** the owner's color blended over terrain (~60–70% opacity) — instant
  ownership read without hiding relief.
- **Borders:** crisp lines of constant **screen-space width** at every zoom, in a darker
  shade of the owner's color; your own border slightly brighter with a soft glow.
- **Fronts:** tiles being fought over glow/pulse in the attacker's color — you can see
  where fighting happens and how fast it moves.
- **Captures:** newly captured tiles flash softly and settle (≈ 0.4 s) — conquest
  reads as motion, not flicker.
- **Hover:** hovered player's land brightens and their border thickens.
- **Labels:** name + troops placed in the largest open area of each territory, sized to
  fit, fading out when too small to read.
- **Player colors:** allocated from a curated palette in a perceptual color space,
  maximizing distance from colors already in use; a colorblind-safe theme later.

### 5.4 Onboarding (Phase 1 level)

Lightweight contextual hints instead of a long tutorial: "Click anywhere to choose your
start" → "Click neutral land to expand" → "Troops grow fastest at half — that's the
tick on your bar" → "Click enemy land to attack". Each hint disappears once done.

---

## 6. Later systems (direction, to be finalized after Phase 1 playtests)

### 6.1 Economy (Phase 2)

Goal: tension between **expansion, reserves, construction, offense and defense**,
understandable without a spreadsheet.

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **E1 — Flat + infrastructure** (OpenFront) | Flat gold/s; extra from trade (ports) and investments | Land doesn't snowball gold; diplomacy is economic | Harder to grasp; "why doesn't my land make money?" |
| **E2 — Land-linked, sublinear** *(leaning)* | Gold/s = base + k·√(land) + buildings | Intuitive ("land = income"); still damped | Some snowball; needs tuning |
| **+ Mobilize** (add-on to either) | Spend gold for instant troops (within capacity) | Creates the investment-vs-army choice | One more control to teach |

**[Decision — Phase 2]** Pick after Phase 1 playtests; we'll prototype E2 + Mobilize
first because it's the most legible.

### 6.2 Buildings (Phase 2) — each with one job

*Superseded on 2026-10-02 by the three-level building design in **§3.17** (PLANNED):
City → **Housing**, Fort → **Border Defense**, Market → **Factory**, Port unchanged, plus
**SAM**, **Missile Silo** and **Airport** (the user's direction, D-021 — this reverses the
earlier "no silos/SAMs before Phase 4"). The original idea, kept for history:*

| Building | Job |
|---|---|
| **City** | +troop capacity (the gold → army engine) |
| **Fort** | Defensive zone: attacks inside its radius cost more and move slower |
| **Port** | Naval access (faster boats, later warships) and trade income |
| **Market** *(maybe)* | Gold income; trade with neighbors/allies (stopped by embargo) |

### 6.3 Naval (Phase 2)

*Built in milestone 2.7 — see **§3.18**.* Transport boats launched from any coast toward a
target shore (max 3 at once), visible route and ETA, landing starts a directed attack from
the beachhead, recall allowed, boat troops count toward the cap. Warships only if
transports prove fun.

### 6.4 Diplomacy (Phase 2)

Alliances: **built in milestone 2.2, see §3.14.** Still to come: donate troops/gold
with cooldowns (2.4), quick pings/emotes (**built in 2.9, §3.20**), mark a target for allies. No free-text
chat in game.

### 6.5 AI (Phase 2+)

Threat and opportunity maps, alliance logic, boats and buildings, betrayal when
profitable, distinct personalities. Same commands as humans.

---

## 7. Balance & tuning approach

1. All constants in one typed `GameRules` object with comments explaining *why*.
2. **Golden tests** pin key formula outputs so balance changes are deliberate.
3. **Headless simulations:** run hundreds of bot-vs-bot games in Node, record game
   length, lead changes, eliminations over time, % of games won by early leader.
4. Playtests with a short checklist: Was the first minute clear? When did you feel
   "grow or strike"? Was there a moment you didn't know what to do?

Target feel for Phase 1: matches of **8–12 minutes** (after the 1.7 speed changes,
8-bot games run a median ~7 min — accepted: the playtest asked for faster land grabs and
crushing attacks, and bigger lobbies in Phase 2 will lengthen games), the leader at minute 3 wins less
than ~60% of games, and players attack every 10–30 s rather than waiting.

---

## 8. Open questions

| # | Question | Default if not decided |
|---|---|---|
| Q1 | Final name of the game | **Decided:** *OpenBorder* (D-014) |
| Q2 | First map: procedural fictional continent or a real-world region? | **Decided:** procedural (D-009) |
| Q3 | Include directed attacks in Phase 1? | **Decided:** yes, tunable `FOCUS_WEIGHT` (D-010) |
| Q4 | Include encirclement in Phase 1? | **Decided:** yes (D-010) |
| Q5 | Win threshold | 70% of land or last standing |
| Q6 | Economy model for Phase 2 | E2 + Mobilize prototype |
