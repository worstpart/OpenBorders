/**
 * Map generation off the main thread (milestone 2.8): a Huge map takes ~2.5 s to generate,
 * which would freeze the start screen. This file is the worker; `generateMapOffThread`
 * (mapGeneration.ts) is the caller's side.
 */
import { generateMap, type MapSpec } from "../sim/map/generate.ts";

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<MapSpec>) => void) | null;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  try {
    const map = generateMap(event.data);
    scope.postMessage(
      { width: map.width, height: map.height, terrain: map.terrain, relief: map.relief },
      [map.terrain.buffer, map.relief.buffer],
    );
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
