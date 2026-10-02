/**
 * Import-boundary guard (ARCHITECTURE.md §8, D-008).
 *
 *   sim    → nothing (no packages either: it must run anywhere, deterministically)
 *   shared → sim
 *   host   → sim, shared (no packages)
 *   client → host, sim, shared, packages
 *   server → sim, shared, packages
 *   client/ui ↛ client/render, client/render ↛ client/ui
 *   nothing in src/ imports spikes/, tests/ or tools/
 */
import { posix } from "node:path";
import { lineAt, maskSource, type SourceFile } from "../helpers/source.ts";

type Area = "sim" | "shared" | "host" | "client" | "server";

const RULES: Record<Area, { mayImport: readonly Area[]; packages: boolean }> = {
  sim: { mayImport: ["sim"], packages: false },
  shared: { mayImport: ["shared", "sim"], packages: true },
  host: { mayImport: ["host", "sim", "shared"], packages: false },
  client: { mayImport: ["client", "host", "sim", "shared"], packages: true },
  server: { mayImport: ["server", "sim", "shared"], packages: true },
};

/** Client sub-folders that must not import each other. */
const FORBIDDEN_CLIENT_PAIRS: readonly [from: string, to: string][] = [
  ["src/client/ui/", "src/client/render/"],
  ["src/client/render/", "src/client/ui/"],
];

const IMPORT_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g, // import x from "…" · export { x } from "…"
  /\bimport\s*["']([^"']+)["']/g, // import "…" (side effects)
  /\bimport\s*\(\s*["']([^"']+)["']/g, // import("…")
];

export interface ImportViolation {
  path: string;
  line: number;
  specifier: string;
  reason: string;
}

function areaOf(path: string): Area | null {
  const top = /^src\/([^/]+)\//.exec(path)?.[1];
  return top !== undefined && top in RULES ? (top as Area) : null;
}

export function findImportViolations(files: readonly SourceFile[]): ImportViolation[] {
  const violations: ImportViolation[] = [];
  for (const file of files) {
    const area = areaOf(file.path);
    if (area === null) {
      violations.push({
        path: file.path,
        line: 1,
        specifier: "",
        reason: `files in src/ must live in one of: ${Object.keys(RULES).join(", ")}`,
      });
      continue;
    }
    const code = maskSource(file.source, { strings: false });
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        const specifier = match[1]!;
        const reason = checkImport(file.path, area, specifier);
        if (reason) {
          violations.push({ path: file.path, line: lineAt(code, match.index), specifier, reason });
        }
      }
    }
  }
  return violations;
}

function checkImport(fromPath: string, area: Area, specifier: string): string | null {
  const rule = RULES[area];
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return rule.packages ? null : `${area}/ may not import packages`;
  }
  if (specifier.startsWith("/")) return "use relative imports inside src/";

  const target = posix.normalize(posix.join(posix.dirname(fromPath), specifier.split("?")[0]!));
  if (!target.startsWith("src/")) return "src/ may not import from outside src/";

  const targetArea = areaOf(target + "/"); // "/" so a bare folder import ("../sim") resolves too
  if (targetArea === null) return "import target is not in a known src/ area";
  if (!rule.mayImport.includes(targetArea)) return `${area}/ may not import ${targetArea}/`;

  for (const [from, to] of FORBIDDEN_CLIENT_PAIRS) {
    if (fromPath.startsWith(from) && target.startsWith(to)) {
      return `${from.slice(4, -1)} may not import ${to.slice(4, -1)}`;
    }
  }
  return null;
}
