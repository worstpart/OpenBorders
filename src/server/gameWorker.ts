/**
 * A game's own thread (D-034: one game per worker thread): builds the ServerGame and runs a
 * tick every rules.tickMs (100 ms) on a drift-free schedule, posting each turn to the main
 * thread, which broadcasts it. A slow tick never holds up other games or the sockets.
 */
import { parentPort } from "node:worker_threads";
import type { Command } from "../sim/commands.ts";
import type { GameConfig } from "../shared/protocol.ts";
import { ServerGame } from "./game.ts";

export type ToGameWorker =
  | { readonly type: "start"; readonly config: GameConfig }
  | { readonly type: "command"; readonly playerId: number; readonly command: Command }
  | { readonly type: "stop" };

export type FromGameWorker =
  | {
      readonly type: "turn";
      readonly tick: number;
      readonly commands: unknown[];
      readonly hash: number;
    }
  | { readonly type: "ended" }
  | { readonly type: "error"; readonly message: string };

const port = parentPort;
if (!port) throw new Error("gameWorker.ts must run in a worker thread");

let game: ServerGame | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let nextAt = 0;
const MAX_CATCH_UP = 5;

function post(message: FromGameWorker): void {
  port!.postMessage(message);
}

function pump(): void {
  timer = null;
  if (!game) return;
  const tickMs = game.world.rules.tickMs;
  const now = performance.now();
  let ran = 0;
  try {
    while (now >= nextAt && ran < MAX_CATCH_UP && !game.ended) {
      const turn = game.tick();
      post({ type: "turn", tick: turn.tick, commands: [...turn.commands], hash: turn.hash });
      nextAt += tickMs;
      ran++;
    }
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    game = null;
    return;
  }
  if (game.ended) {
    post({ type: "ended" });
    game = null;
    return;
  }
  // Far behind (an overloaded machine): carry on from now rather than racing to catch up.
  if (now - nextAt > tickMs * MAX_CATCH_UP) nextAt = now + tickMs;
  timer = setTimeout(pump, Math.max(0, nextAt - performance.now()));
}

port.on("message", (message: ToGameWorker) => {
  switch (message.type) {
    case "start":
      try {
        game = new ServerGame(message.config);
      } catch (error) {
        post({ type: "error", message: error instanceof Error ? error.message : String(error) });
        return;
      }
      nextAt = performance.now() + game.world.rules.tickMs;
      timer = setTimeout(pump, game.world.rules.tickMs);
      break;
    case "command":
      game?.queue(message.playerId, message.command);
      break;
    case "stop":
      if (timer) clearTimeout(timer);
      game = null;
      port.close();
      break;
  }
});
