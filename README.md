# OpenBorder

A browser-based, real-time territory strategy game: start small, expand, grow, meet
your neighbors, fight or ally, and control the map.

> *Easy to understand in 30 seconds, difficult to master.*

Inspired by the mechanics of [OpenFront](https://openfront.io/) but built as an
independent implementation (decision D-001) with its own code, design and
presentation. Not affiliated with OpenFront.

## Status

**Phase 1 — Playable prototype: complete** (git tag `phase-1`): spawn, expand, fight bots,
encircle, win or lose, with a full HUD. **Phase 2 — Gameplay depth: complete** (git tag
`phase-2`): big lobbies (up to 125 opponents); Tribes & Nations (weak filler tribes,
nations with Easy/Medium/Hard); alliances (timed, renewable, traitors); teams; gold and
gifts; buildings — Housing, Factory, Port, levels I–III; walls drawn point by
point; islands, boats and beachhead landings; trade ships; map types Continent / Islands /
Two lands in three sizes; alert sounds, map pings and emojis. **Phase 2B — air & strategic
warfare: complete** (git tag `phase-2b`, approved by the user's playtest; the fixes from that
playtest — D-033 — came right after it): the user's icon-pack art; Airports I–III
(airlifts, airborne assaults, air strikes), SAMs I–III, Missile Silos I–III (strike missiles,
bunker busters, the strategic warhead), Port III Naval Base (warships, coastal fortification)
and a balance pass. **Next: Phase 3 — multiplayer** (plan in [docs/ROADMAP.md](docs/ROADMAP.md)).
A new working session starts by reading the latest handoff in `docs/handoffs/`
(currently [PHASE_2B_HANDOFF.md](docs/handoffs/PHASE_2B_HANDOFF.md)).

## Running it

Requires **Node.js 24 LTS** and a browser with WebGL2 (all current desktop browsers).

```bash
npm install
```

| Command | What it does |
|---|---|
| `npm run dev` | Starts the game at <http://localhost:5173> with instant reload |
| `npm test` | Runs all tests once (`npm run test:watch` to re-run on save) |
| `npm run check` | Type-checks TypeScript and Svelte files |
| `npm run build` | Production build into `dist/` (`npm run preview` serves it) |
| `npm run format` | Formats code with Prettier (Markdown is left as written) |
| `npm run headless -- --games 20` | Plays bots-only games without a browser and reports winners, game length, lead changes and tick times, with a per-system breakdown (options: `--bots` nations, `--tribes`, `--difficulty`, `--width`/`--height` for the map size, `--seed`, `--map-seed`, `--max-minutes`, `--json file`, `--rules overrides.json` to try rule changes, `--personality` to give every bot the same one, `--no-alliances`, `--no-economy`, `--no-buildings`, `--no-boats` to switch systems off, `--continent` for the old island-free map, `--teams N`) |
| `node tools/speeds.ts` | Measures how fast fronts move on each terrain and at each troop advantage (tiles per second); takes `--rules overrides.json` too |

## Controls (so far)

| Input | Action |
|---|---|
| Left click | Choose / move your start (spawn phase); then expand into neutral land or attack enemy land — land you can't reach over your border (another island, a player you don't border) gets a boat |
| Enter | Confirm your start |
| Shift + 1 2 3 4 5 (or numpad 1–5) | Send 10 / 25 / 50 / 75 / 100% of your home troops per click |
| Q / E, Shift + wheel | Send 5% less / more |
| × on an attack chip | Retreat (troops return after 2 s, −20% against players) |
| ↩ on a boat chip | Turn the boat back (its troops come home when it is back) |
| Build bar (bottom), keys 1–7 | Pick up Housing (1), Factory (2), Port (3, coast only), Airport (4), SAM Site (5), Missile Silo (6) or the Wall tool (7); click your land to place; right-click / Esc puts it back |
| Missile launcher (once you own a Silo), R / T / X | Aim a strike missile / bunker buster / strategic warhead; every click on enemy land fires one from a Silo that can reach it, while any are ready |
| Click your warship, then the sea | Send it there to patrol and fight |
| V | Air defence view: every SAM's range |
| G | Ping the map for your allies and teammates |
| Play again (end card) | Back to the start screen for a new game |
| Drag (any button) | Pan |
| Mouse wheel | Zoom toward the cursor |
| W A S D / arrows | Pan |
| Space | Center on your territory |
| Right click | Options for that land: attack presets, a boat, request / accept / renew / break an alliance, gifts to friends |
| K | Ally with the player under the cursor (request, or accept their request) |
| Y / N | Yes / no to the top alliance card (accept or decline a request, renew or let it end) |
| F3 or ` | Performance overlay |

## Code layout

| Folder | What lives there |
|---|---|
| `src/sim/` | The deterministic game simulation: rules, map, systems, AI. No DOM, no packages, no randomness except the seeded RNG — enforced by tests |
| `src/host/` | Runs the simulation and schedules command turns (`LocalHost` in Phase 1) |
| `src/client/` | The browser game: `app/` (screens, session), `input/`, `camera/`, `render/` (WebGL2), `ui/` (Svelte HUD, design tokens) |
| `tests/` | All tests, mirroring `src/`, plus guard tests for the rules above |
| `tools/` | Command-line tools (e.g. the headless bots-only runner) |
| `spikes/` | Throwaway experiments; never imported by `src/` |

## Documentation

| Document | What's in it |
|---|---|
| [docs/OPENFRONT_RESEARCH.md](docs/OPENFRONT_RESEARCH.md) | How OpenFront works internally, system by system; licensing; exploits; what to keep vs. redesign |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Our game: pillars, Phase 1 rules and formulas, controls, HUD and visual design |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack and why, rendering benchmark, simulation, multiplayer plan, structure, testing |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases, Phase 1 milestones, feature matrix, risk register |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log (accepted and proposed) |
| [docs/handoffs/](docs/handoffs/) | One handoff per phase — **a new session starts by reading the latest one** |

## Rendering benchmark (Phase 0 spike)

```bash
node spikes/render-benchmark/serve.mjs
```

Then open <http://localhost:5179/?w=2000&h=1000&players=64&changes=8000&fx=1>.
Parameters: `w`, `h` (map size), `players`, `changes` (tile changes per tick),
`run` (ms per renderer), `fx=1` (capture animations).

## License

To be decided. No third-party game code or assets are included.
