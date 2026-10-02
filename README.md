# OpenBorder

A browser-based, real-time territory strategy game: start small, expand, grow, meet
your neighbors, fight or ally, and control the map.

> *Easy to understand in 30 seconds, difficult to master.*

Inspired by the mechanics of [OpenFront](https://openfront.io/) but built as an
independent implementation (decision D-001) with its own code, design and
presentation. Not affiliated with OpenFront.

## Status

**Phase 1 — Playable prototype: complete** (git tag `phase-1`): spawn, expand, fight bots,
encircle, win or lose, with a full HUD. **Phase 2 — in progress:** big lobbies (up to 125
opponents, Normal or Large map) ✅; Tribes & Nations (weak filler tribes, nations with
Easy/Medium/Hard) ✅; next alliances, then teams (plan in [docs/ROADMAP.md](docs/ROADMAP.md)).
A new working session starts by reading the latest handoff in `docs/handoffs/`
(currently [PHASE_2_AFTER_2.1_HANDOFF.md](docs/handoffs/PHASE_2_AFTER_2.1_HANDOFF.md)).

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
| `npm run headless -- --games 20` | Plays bots-only games without a browser and reports winners, game length, lead changes and tick times, with a per-system breakdown (options: `--bots` nations, `--tribes`, `--difficulty`, `--width`/`--height` for the map size, `--seed`, `--map-seed`, `--max-minutes`, `--json file`, `--rules overrides.json` to try rule changes, `--personality` to give every bot the same one) |
| `node tools/speeds.ts` | Measures how fast fronts move on each terrain and at each troop advantage (tiles per second); takes `--rules overrides.json` too |

## Controls (so far)

| Input | Action |
|---|---|
| Left click | Choose / move your start (spawn phase); then expand into neutral land or attack enemy land |
| Enter | Confirm your start |
| 1 2 3 4 5 | Send 10 / 25 / 50 / 75 / 100% of your home troops per click |
| Q / E, Shift + wheel | Send 5% less / more |
| × on an attack chip | Retreat (troops return after 2 s, −20% against players) |
| Play again (end card) | Back to the start screen for a new game |
| Drag (any button) | Pan |
| Mouse wheel | Zoom toward the cursor |
| W A S D / arrows | Pan |
| Space | Center on your territory |
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
