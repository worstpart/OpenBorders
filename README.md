# Borderline *(working title)*

A browser-based, real-time territory strategy game: start small, expand, grow, meet
your neighbors, fight or ally, and control the map.

> *Easy to understand in 30 seconds, difficult to master.*

Inspired by the mechanics of [OpenFront](https://openfront.io/) but built as an
independent implementation (pending decision D-001) with its own code, design and
presentation. Not affiliated with OpenFront.

## Status

**Phase 0 — Research: complete.** Next: Phase 1 (playable prototype). See the
latest handoff in `docs/handoffs/`.

| Document | What's in it |
|---|---|
| [docs/OPENFRONT_RESEARCH.md](docs/OPENFRONT_RESEARCH.md) | How OpenFront works internally, system by system; licensing; exploits; what to keep vs. redesign |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Our game: pillars, Phase 1 rules and formulas, controls, HUD and visual design |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack and why, rendering benchmark, simulation, multiplayer plan, structure, testing |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases, Phase 1 milestones, feature matrix, risk register |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log (accepted and proposed) |
| [docs/handoffs/](docs/handoffs/) | One handoff per phase — **a new session starts by reading the latest one** |

## Requirements (from Phase 1)

- **Node.js 24 LTS** (installed: 24.19.0 with npm 11.17.0 — see D-013)
- A browser with WebGL2 (all current desktop browsers)

## Rendering benchmark (Phase 0 spike)

```bash
node spikes/render-benchmark/serve.mjs
```

Then open <http://localhost:5179/?w=2000&h=1000&players=64&changes=8000&fx=1>.
Parameters: `w`, `h` (map size), `players`, `changes` (tile changes per tick),
`run` (ms per renderer), `fx=1` (capture animations).

## License

To be decided (see D-001). No third-party game code or assets are included.
