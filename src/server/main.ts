/**
 * The game server (Phase 3, D-006 / D-034): one Node process that serves the built client
 * (dist/) and the game WebSocket (/ws) on the same address, and runs every game in its own
 * worker thread.
 *
 *   npm run build && npm start           → http://localhost:8787 (PORT to change it)
 *
 * In development the Vite page connects to this server on port 8787 (see the client's
 * online.ts), so `npm start` alone is enough next to the dev server.
 */
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { WebSocketServer, type WebSocket } from "ws";
import {
  MAX_CLIENT_MESSAGE_BYTES,
  SOCKET_PATH,
  type GameConfig,
  type ServerMessage,
} from "../shared/protocol.ts";
import type { FromGameWorker, ToGameWorker } from "./gameWorker.ts";
import { Lobbies, type GameEvents, type GameRunner } from "./lobbies.ts";

const PORT = Number(process.env["PORT"] ?? 8787);
const HOST = process.env["HOST"] ?? "0.0.0.0";
const DIST = resolve(fileURLToPath(new URL("../../dist", import.meta.url)));
/** Messages a browser may send per second before the server hangs up (3.3 refines this). */
const MAX_MESSAGES_PER_SECOND = 40;
const PING_MS = 25_000;

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

// --- Games: one worker thread each -------------------------------------------------------

function startRunner(config: GameConfig, events: GameEvents): GameRunner {
  const worker = new Worker(new URL("./gameWorker.ts", import.meta.url));
  let done = false;
  const finish = (error?: string) => {
    if (done) return;
    done = true;
    void worker.terminate();
    events.ended(error);
  };
  worker.on("message", (message: FromGameWorker) => {
    if (message.type === "turn") {
      events.turn({
        t: "turn",
        tick: message.tick,
        commands: message.commands as never,
        hash: message.hash,
      });
    } else if (message.type === "ended") finish();
    else finish(message.message);
  });
  worker.on("error", (error) => finish(error.message));
  const post = (message: ToGameWorker) => worker.postMessage(message);
  post({ type: "start", config });
  return {
    command: (playerId, command) => post({ type: "command", playerId, command }),
    stop: () => {
      done = true;
      post({ type: "stop" });
      setTimeout(() => void worker.terminate(), 1_000).unref();
    },
  };
}

const lobbies = new Lobbies({
  startRunner,
  newGameId: () => randomBytes(9).toString("base64url"),
  newSeed: () => randomBytes(4).readUInt32LE(0),
  log,
});

// --- The page: static files from dist/ -----------------------------------------------------

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

async function serveFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end(`ok ${lobbies.gameCount} games\n`);
    return;
  }
  let path = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (path !== DIST && !path.startsWith(DIST + sep)) {
    res.writeHead(403).end();
    return;
  }
  // Paths without a file extension (e.g. "/" or a game link) get the page itself.
  if (extname(path) === "") path = join(DIST, "index.html");
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
    const body = await readFile(path);
    const immutable = path.startsWith(join(DIST, "assets") + sep);
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
  }
}

const server = createServer((req, res) => {
  serveFile(req, res).catch((error: unknown) => {
    log(`http error: ${String(error)}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

// --- The game socket ----------------------------------------------------------------------

const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });

server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://x").pathname !== SOCKET_PATH) {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => accept(ws));
});

function accept(ws: WebSocket): void {
  let alive = true;
  let windowStart = Date.now();
  let messages = 0;
  const peer = {
    send: (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    },
    close: (reason: string) => ws.close(1008, reason.slice(0, 100)),
  };
  const connection = lobbies.connect(peer);
  ws.on("message", (data, isBinary) => {
    const now = Date.now();
    if (now - windowStart >= 1_000) {
      windowStart = now;
      messages = 0;
    }
    if (++messages > MAX_MESSAGES_PER_SECOND) return peer.close("too many messages");
    if (isBinary) return peer.close("binary message");
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return peer.close("bad JSON");
    }
    connection.receive(parsed);
  });
  ws.on("pong", () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, PING_MS);
  ws.on("close", () => {
    clearInterval(ping);
    connection.closed();
  });
  ws.on("error", () => ws.terminate());
}

server.listen(PORT, HOST, () =>
  log(`OpenBorder server on http://${HOST}:${PORT} (serving ${DIST})`),
);
