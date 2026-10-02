import { describe, expect, it } from "vitest";
import { readSourceFiles } from "../helpers/source.ts";
import { findBannedApis } from "./bannedApis.ts";

const file = (source: string) => [{ path: "src/sim/example.ts", source }];
const matches = (source: string) => findBannedApis(file(source)).map((v) => v.match);

describe("determinism guard: banned APIs in src/sim", () => {
  it("src/sim uses none of them", () => {
    const files = readSourceFiles("src/sim", [".ts"]);
    expect(files.length).toBeGreaterThan(0);
    const violations = findBannedApis(files);
    const report = violations.map((v) => `${v.path}:${v.line} ${v.match} — ${v.reason}`);
    expect(report).toEqual([]);
  });

  // The checks below make sure the guard itself works, so a broken pattern can't
  // silently let everything through.
  it("detects randomness, clocks, timers and engine-dependent math", () => {
    expect(matches("const r = Math.random();")).toEqual(["Math.random"]);
    expect(matches("const a = Math.pow(2, 3) + Math.sin(x) + Math.atan2(y, x);")).toEqual([
      "Math.pow",
      "Math.sin",
      "Math.atan2",
    ]);
    expect(matches("const b = x ** 0.6;")).toEqual(["**"]);
    expect(matches("const now = Date.now(); const t = performance.now();")).toEqual([
      "Date",
      "performance",
    ]);
    expect(matches("setTimeout(tick, 100); queueMicrotask(run);")).toEqual([
      "setTimeout",
      "queueMicrotask",
    ]);
    expect(matches("window.foo = 1; globalThis.bar = 2; process.exit(1);")).toEqual([
      "window",
      "globalThis",
      "process",
    ]);
    expect(matches("names.sort((a, b) => a.localeCompare(b));")).toEqual(["localeCompare"]);
  });

  it("allows exact Math functions, property names and mentions in comments or strings", () => {
    expect(matches("const d = Math.sqrt(x) + Math.floor(y) + Math.imul(a, b);")).toEqual([]);
    expect(matches("attack.process(); const dateOfBirth = 1; const updated = 2;")).toEqual([]);
    expect(matches("// Math.random is banned\n/** never use Date */ const x = 1;")).toEqual([]);
    expect(matches('const message = "do not call Math.random or Date.now";')).toEqual([]);
  });

  it("still checks code inside template literal expressions", () => {
    expect(matches("const s = `tick ${Math.random()} at ${count}`;")).toEqual(["Math.random"]);
    expect(matches("const s = `Math.random ${count}`;")).toEqual([]);
  });

  it("reports the correct line", () => {
    const [violation] = findBannedApis(file("const a = 1;\n\nconst b = Math.random();"));
    expect(violation?.line).toBe(3);
  });
});
