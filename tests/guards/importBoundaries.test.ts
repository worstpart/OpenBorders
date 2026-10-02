import { describe, expect, it } from "vitest";
import { readSourceFiles } from "../helpers/source.ts";
import { findImportViolations } from "./importBoundaries.ts";

const reasons = (path: string, source: string) =>
  findImportViolations([{ path, source }]).map((v) => `${v.specifier}: ${v.reason}`);

describe("import boundaries between src/ areas", () => {
  it("the project follows them", () => {
    const files = readSourceFiles("src", [".ts", ".svelte"]);
    expect(files.length).toBeGreaterThan(0);
    const report = findImportViolations(files).map(
      (v) => `${v.path}:${v.line} "${v.specifier}" — ${v.reason}`,
    );
    expect(report).toEqual([]);
  });

  // The checks below make sure the guard itself works.
  it("keeps the simulation free of packages and other areas", () => {
    expect(reasons("src/sim/world.ts", 'import { x } from "./map/grid.ts";')).toEqual([]);
    expect(reasons("src/sim/world.ts", 'import { mount } from "svelte";')).toEqual([
      "svelte: sim/ may not import packages",
    ]);
    expect(
      reasons("src/sim/world.ts", 'import { LocalHost } from "../host/localHost.ts";'),
    ).toEqual(["../host/localHost.ts: sim/ may not import host/"]);
    expect(reasons("src/sim/ai/bot.ts", 'export * from "../../client/main.ts";')).toEqual([
      "../../client/main.ts: sim/ may not import client/",
    ]);
  });

  it("lets the client use host, sim and packages, but keeps ui and render apart", () => {
    const ok = 'import { mount } from "svelte";\nimport type { World } from "../../sim/world.ts";';
    expect(reasons("src/client/app/session.ts", ok)).toEqual([]);
    expect(reasons("src/client/ui/Hud.svelte", 'import "../render/renderer.ts";')).toEqual([
      "../render/renderer.ts: client/ui may not import client/render",
    ]);
    expect(reasons("src/client/render/labels.ts", 'const m = import("../ui/App.svelte");')).toEqual(
      ["../ui/App.svelte: client/render may not import client/ui"],
    );
  });

  it("forbids importing spikes, tests or tools from src", () => {
    expect(reasons("src/client/main.ts", 'import "../../spikes/render-benchmark/x.ts";')).toEqual([
      "../../spikes/render-benchmark/x.ts: src/ may not import from outside src/",
    ]);
  });

  it("ignores commented-out imports and strips Vite query suffixes", () => {
    expect(reasons("src/sim/world.ts", '// import { mount } from "svelte";')).toEqual([]);
    expect(reasons("src/client/render/x.ts", 'import src from "./shaders/map.frag?raw";')).toEqual(
      [],
    );
  });
});
