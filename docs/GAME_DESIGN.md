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
| Win | Control 70% of the land or outlast everyone | |

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
| Two players attack each other | The two armies collide and cancel out first |

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

- **Victory:** control **≥ 70% of all land**, or be the last player standing.
- **Defeat:** your territory reaches zero. You may keep watching (spectate) or restart.
- **Anti-stall** (pulled into Phase 1 at milestone 1.7): after **15 min** the land
  requirement drops **1% every 30 s**, down to **50%** at 25 min. The HUD shows the
  current goal next to the clock ("Win 70%", amber once it drops) and a toast announces
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
   size: opposing armies cancel out, so this is cheap defence.
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
| Victory | **only your own land counts** (70% or last standing); alliances don't share a win | Shared victory is what teams (2.3) are for. Two allies left alone will have to fight: nations never ally or renew when only two contenders are left |
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
    Adjustable by click, `1–5`, `Q/E`, or Shift+wheel. Fill animates smoothly.
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
  10–100 (keys 1–5) plus the live troop count; a non-preset value (Q/E, Shift+wheel) is
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
  why it can't (not bordering, spawn protection countdown, no troops).
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

| Building | Job |
|---|---|
| **City** | +troop capacity (the gold → army engine) |
| **Fort** | Defensive zone: attacks inside its radius cost more and move slower |
| **Port** | Naval access (faster boats, later warships) and trade income |
| **Market** *(maybe)* | Gold income; trade with neighbors/allies (stopped by embargo) |

Nukes/missile silos/SAMs: **not planned** before Phase 4; the core game must be fun
without them.

### 6.3 Naval (Phase 2)

Transport boats launched from any coast toward a target shore (max 3 at once),
visible route and ETA, landing starts a directed attack from the beachhead, recall
allowed, boat troops count toward the cap. Warships only if transports prove fun.

### 6.4 Diplomacy (Phase 2)

Alliances: **built in milestone 2.2, see §3.14.** Still to come: donate troops/gold
with cooldowns (2.4), quick pings/emotes (2.8), mark a target for allies. No free-text
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
