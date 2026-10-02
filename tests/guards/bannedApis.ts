/**
 * Determinism guard (ARCHITECTURE.md §5.4): APIs that must never appear in src/sim.
 *
 * Every machine must compute bit-identical simulation results from the same seed and
 * commands. These APIs break that: randomness, clocks and timers differ per machine,
 * transcendental Math functions may differ in the last bit between JS engines, and
 * locale-aware functions differ per user. Use sim/math (seeded RNG, detmath) instead.
 * Math.sqrt, floor, round, min, max, abs, imul etc. are exact by spec and allowed.
 */
import { lineAt, maskSource, type SourceFile } from "../helpers/source.ts";

// Matches a bare global name, not a property access like `attack.process`.
const global = (names: string): RegExp => new RegExp(`(?<![.\\w$])(?:${names})\\b`, "g");

export const BANNED_IN_SIM: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\bMath\.random\b/g, reason: "Math.random is not seeded; use the world RNG" },
  {
    pattern:
      /\bMath\.(?:pow|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|cbrt)\b/g,
    reason: "may differ in the last bit between engines; use sim/math/detmath",
  },
  { pattern: /\*\*/g, reason: "the ** operator is Math.pow; use sim/math/detmath" },
  { pattern: global("Date"), reason: "wall-clock time differs per machine; use the tick" },
  { pattern: global("performance"), reason: "wall-clock time differs per machine" },
  {
    pattern: global(
      "setTimeout|setInterval|setImmediate|requestAnimationFrame|requestIdleCallback|queueMicrotask",
    ),
    reason: "timers are not deterministic; the host drives ticks",
  },
  {
    pattern: global(
      "window|document|globalThis|self|navigator|process|localStorage|sessionStorage|fetch|XMLHttpRequest|WebSocket|Worker|crypto|require",
    ),
    reason: "the simulation must not touch the environment (DOM, network, Node)",
  },
  {
    pattern: /\b(?:localeCompare|toLocaleString|toLocaleUpperCase|toLocaleLowerCase|Intl)\b/g,
    reason: "locale-dependent results differ per user",
  },
];

export interface Violation {
  path: string;
  line: number;
  match: string;
  reason: string;
}

export function findBannedApis(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const code = maskSource(file.source, { strings: true });
    for (const { pattern, reason } of BANNED_IN_SIM) {
      for (const match of code.matchAll(pattern)) {
        violations.push({
          path: file.path,
          line: lineAt(code, match.index),
          match: match[0],
          reason,
        });
      }
    }
  }
  return violations;
}
