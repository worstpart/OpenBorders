/**
 * Generates a map in a short-lived worker (mapWorker.ts) so the page stays responsive;
 * falls back to the main thread where workers aren't available or the worker fails to load
 * (e.g. the dev server went away). Same spec, same map.
 */
import { createMap, type GameMap } from "../sim/map/gameMap.ts";
import { generateMap, type MapSpec } from "../sim/map/generate.ts";

type Reply =
  { width: number; height: number; terrain: Uint8Array; relief: Uint8Array } | { error: string };

export function generateMapOffThread(spec: MapSpec): Promise<GameMap> {
  if (typeof Worker === "undefined") return Promise.resolve(generateMap(spec));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./mapWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<Reply>) => {
      worker.terminate();
      const reply = event.data;
      if ("error" in reply) reject(new Error(reply.error));
      else resolve(createMap(reply.width, reply.height, reply.terrain, reply.relief));
    };
    worker.onerror = (event) => {
      worker.terminate();
      console.warn(`map worker failed (${event.message || "no message"}); generating here`);
      try {
        resolve(generateMap(spec));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    worker.postMessage(spec);
  });
}
