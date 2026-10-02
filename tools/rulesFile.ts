/**
 * Rule overrides for the command-line tools: a JSON file deep-merged into DEFAULT_RULES
 * (e.g. {"troops": {"growthFloor": 20}}), to try a balance change before editing rules.ts.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_RULES, type GameRules } from "../src/sim/rules.ts";

/** DEFAULT_RULES, with the overrides in `path` (if any) merged in. */
export function loadRules(path: string | undefined): GameRules {
  if (!path) return DEFAULT_RULES;
  return merge(DEFAULT_RULES, JSON.parse(readFileSync(path, "utf8"))) as GameRules;
}

/** Deep-merges plain objects: `patch` values replace `base` values, objects merge. */
function merge(base: unknown, patch: unknown): unknown {
  if (typeof base !== "object" || base === null || typeof patch !== "object" || patch === null) {
    return patch;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in out)) throw new Error(`unknown rule "${key}"`);
    out[key] = merge(out[key], value);
  }
  return out;
}
