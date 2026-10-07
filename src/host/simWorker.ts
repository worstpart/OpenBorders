/**
 * The simulation worker (WorkerHost's other half, milestone 2.8): a LocalHost on its own
 * thread. It runs the turns on its own timer and posts every frame, slimmed down (see
 * workerProtocol.ts), so the main thread only draws.
 */
import { createMap } from "../sim/map/gameMap.ts";
import { LocalHost } from "./localHost.ts";
import { FrameSlimmer, type FromWorker, type ToWorker } from "./workerProtocol.ts";

interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let host: LocalHost | null = null;
const slimmer = new FrameSlimmer();

function fail(error: unknown): void {
  scope.postMessage({
    type: "error",
    message: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    switch (message.type) {
      case "start": {
        if (host) throw new Error("the simulation worker was started twice");
        const map = createMap(message.width, message.height, message.terrain, message.relief);
        host = new LocalHost({ localPlayerId: message.localPlayerId });
        host.onFrame((frame, timing) => {
          try {
            const { wire, transfer } = slimmer.slim(frame);
            scope.postMessage({ type: "frame", frame: wire, tickMs: timing.tickMs }, transfer);
          } catch (error) {
            fail(error);
          }
        });
        void host
          .start({ seed: message.seed, map, players: message.players, rules: message.rules })
          .then((initial) => {
            const { wire, transfer } = slimmer.slim(initial.frame);
            scope.postMessage({ type: "started", owner: initial.owner, frame: wire }, [
              initial.owner.buffer,
              ...transfer,
            ]);
          }, fail);
        break;
      }
      case "send":
        if (message.playerId === null) host?.send(message.command);
        else host?.sendAs(message.playerId, message.command);
        break;
      case "pause":
        host?.pause();
        break;
      case "resume":
        host?.resume();
        break;
      case "speed":
        host?.setSpeed(message.multiplier);
        break;
    }
  } catch (error) {
    fail(error);
  }
};
