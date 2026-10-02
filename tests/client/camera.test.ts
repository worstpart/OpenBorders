import { describe, expect, it } from "vitest";
import { Camera } from "../../src/client/camera/camera.ts";

function makeCamera(): Camera {
  const camera = new Camera();
  camera.setViewport(1000, 500);
  camera.setMap(200, 100);
  return camera;
}

describe("Camera", () => {
  it("starts showing the whole map", () => {
    const camera = makeCamera();
    expect(camera.zoom).toBe(5); // 1000 px / 200 tiles
    expect(camera.center).toEqual({ x: 100, y: 50 });
    expect(camera.tileAt({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(camera.tileAt({ x: 999, y: 499 })).toEqual({ x: 199, y: 99 });
  });

  it("converts between screen and world both ways", () => {
    const camera = makeCamera();
    const world = { x: 37.25, y: 81.5 };
    const back = camera.screenToWorld(camera.worldToScreen(world));
    expect(back.x).toBeCloseTo(world.x, 10);
    expect(back.y).toBeCloseTo(world.y, 10);
  });

  it("returns no tile outside the map", () => {
    const camera = makeCamera();
    camera.zoomAt(0.5, { x: 500, y: 250 });
    camera.update(10);
    expect(camera.tileAt({ x: 1, y: 1 })).toBeNull();
  });

  it("zooms toward the cursor: the world point under it stays put", () => {
    const camera = makeCamera();
    const anchor = { x: 800, y: 100 };
    const before = camera.screenToWorld(anchor);
    camera.zoomAt(4, anchor);
    for (let frame = 0; frame < 30; frame++) camera.update(1 / 60);
    const after = camera.screenToWorld(anchor);
    expect(camera.zoom).toBeGreaterThan(5);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("keeps zoom within limits", () => {
    const camera = makeCamera();
    camera.zoomAt(1e6, { x: 0, y: 0 });
    camera.update(10);
    expect(camera.zoom).toBe(camera.maxZoom);
    camera.zoomAt(1e-6, { x: 0, y: 0 });
    camera.update(10);
    expect(camera.zoom).toBe(camera.minZoom);
  });

  it("pans by screen distance and never leaves the map entirely", () => {
    const camera = makeCamera();
    camera.panBy(-50, 25); // drag left/down → view moves right/up
    expect(camera.center).toEqual({ x: 110, y: 45 });
    camera.panBy(1e6, 1e6);
    expect(camera.center).toEqual({ x: 0, y: 0 });
  });

  it("eases toward a focus point", () => {
    const camera = makeCamera();
    camera.focusOn({ x: 20, y: 30 });
    for (let frame = 0; frame < 120; frame++) camera.update(1 / 60);
    expect(camera.center.x).toBeCloseTo(20, 1);
    expect(camera.center.y).toBeCloseTo(30, 1);
  });
});
