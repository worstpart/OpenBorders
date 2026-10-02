# Game Design

> **Status:** initial draft (Phase 0). Numbers are starting points to be tuned by
> playtesting and headless bot-vs-bot simulations. Anything marked **[Decision]**
> needs your input; see also `DECISIONS.md`.
>
> **Working title:** *Borderline* (placeholder codename — not final, and deliberately
> unrelated to the OpenFront name).

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

- 1 human + **7 AI opponents** by default (configurable 1–15).
- **Spawn phase:** the human clicks any valid land to choose a start (can re-pick until
  confirming / the phase ends). AI spawns randomly, keeping a minimum distance from
  everyone else. Single-player starts the moment the human confirms.
- A spawn claims a small disc (radius 4 = 49 tiles): only **neutral land connected to the
  chosen tile** (a disc never jumps across water or takes someone else's land).
- Random spawns (bots, or players who didn't pick) need ≥ 80% of a full disc, and keep
  ≥ 70 tiles from other spawns when the map allows it (relaxed step by step on crowded
  maps).
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
Speed                    ≈ NEUTRAL_SPEED × frontier tiles per tick
                          × terrain factor (plains 1.0 · highland 0.8 · mountain 0.6)
                          × min(1, army / 2,000)     ← tiny armies crawl
```

- Expansion is **directed** (§3.7): it flows outward from where you clicked first,
  then spreads.
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
tiles per tick       ≈ frontier × PVP_SPEED ÷ (TERRAIN_SLOW × clamp(r, 0.8, 8))
                       (further slowed when r > 20: hopeless attacks barely move)
```

| Effect | Result |
|---|---|
| Commit more troops | Cheaper per tile *and* faster (r falls) |
| Defender fighting elsewhere | Their home pool is lower → easier to attack everywhere |
| Wide shared border | More frontier → faster attacks (for both sides) |
| Mountains | ~1.5× losses and ~1.5× slower than plains |
| Two players attack each other | The two armies collide and cancel out first |

- **Retreat:** cancel an attack from its chip (×). It stops advancing immediately;
  troops return after 2 s minus **20%** (no penalty when retreating from neutral land).
- An attack ends when its army is spent or nothing reachable remains; survivors return.

### 3.7 Directed attacks (our key combat improvement)

OpenFront attacks spread over the entire shared border; aiming is impossible
(their longest-standing feature request). We make **where you click matter**:

```
priority(tile) = waveOrder + small noise
               + TERRAIN_DELAY (mountains later)
               − FILL_BONUS × (own neighbours)      (smooths the front)
               + FOCUS_WEIGHT × distance(tile, click point)
```

Tiles near the click point fall first; the attack then widens outward from there.
This rewards **position**: drive toward a chokepoint, split an enemy in two, cut off a
pocket for encirclement, or avoid mountains. `FOCUS_WEIGHT = 0` reproduces a classic
"whole-border" attack, so we can tune between the two in playtests.

### 3.8 Encirclement

Every 2 s (staggered per player), any piece of a player's territory that is
**completely enclosed** by other players' land — touching no water, no map edge and no
neutral land — is annexed instantly by the surrounding player (if several surround it,
the one with the longest shared border, or the one actively attacking). Coasts are safe.

### 3.9 Elimination

- A player with **0 tiles** is eliminated.
- When an attacked player falls below **40 tiles**, their remaining land is absorbed by
  the attacker and adjacent enemies (avoids tedious mop-up).
- Eliminations are visible moments: toast, map pulse, name greys out on the
  leaderboard.

### 3.10 Victory & defeat

- **Victory:** control **≥ 70% of all land**, or be the last player standing.
- **Defeat:** your territory reaches zero. You may keep watching (spectate) or restart.
- Anti-stall (Phase 2): after N minutes the land requirement slowly decreases.

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

Alliance requests (expire in 20 s), alliances last ~5 min and renew only if both agree,
allies can't attack each other, **betrayal** marks you a traitor for 30 s (weaker
defense, visible marker), donate troops/gold with cooldowns, quick pings/emotes, mark a
target for allies. No free-text chat in game.

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

Target feel for Phase 1: matches of **8–12 minutes**, the leader at minute 3 wins less
than ~60% of games, and players attack every 10–30 s rather than waiting.

---

## 8. Open questions

| # | Question | Default if not decided |
|---|---|---|
| Q1 | Final name of the game | Keep codename *Borderline* until later |
| Q2 | First map: procedural fictional continent or a real-world region? | **Decided:** procedural (D-009) |
| Q3 | Include directed attacks in Phase 1? | **Decided:** yes, tunable `FOCUS_WEIGHT` (D-010) |
| Q4 | Include encirclement in Phase 1? | **Decided:** yes (D-010) |
| Q5 | Win threshold | 70% of land or last standing |
| Q6 | Economy model for Phase 2 | E2 + Mobilize prototype |
