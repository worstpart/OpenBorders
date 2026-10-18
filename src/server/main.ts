/**
 * The game server (Phase 3, D-006 / D-034): one Node process that serves the built client
 * (dist/) and the game WebSocket (/ws) on the same address, and runs every game in its own
 * worker thread.
 *
 *   npm run build && npm start           → http://localhost:8787 (PORT to change it)
 *
 * In development the Vite page connects to this server on port 8787 (see the client's
 * online.ts), so `npm start` alone is enough next to the dev server.
 *
 * Accounts (3.7, D-037) live in a SQLite file in DATA_DIR — on Railway the volume's mount
 * path (RAILWAY_VOLUME_MOUNT_PATH), locally ./data. Google sign-in is on when
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set (PUBLIC_ORIGIN: the site's address as
 * registered with Google, if it differs from what requests say).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { WebSocketServer, type WebSocket } from "ws";
import {
  MAX_CLIENT_MESSAGE_BYTES,
  OPEN_GAMES_PATH,
  SOCKET_PATH,
  type GameConfig,
  type ServerMessage,
} from "../shared/protocol.ts";
import { AccountApi, type SignedIn } from "./accountApi.ts";
import { AccountStore } from "./accountStore.ts";
import type { FromGameWorker, ToGameWorker } from "./gameWorker.ts";
import { Lobbies, type GameEvents, type GameRunner } from "./lobbies.ts";

const PORT = Number(process.env["PORT"] ?? 8787);
const HOST = process.env["HOST"] ?? "0.0.0.0";
const DIST = resolve(fileURLToPath(new URL("../../dist", import.meta.url)));
/** Messages a browser may send per second before the server hangs up (3.3 refines this). */
const MAX_MESSAGES_PER_SECOND = 40;
const PING_MS = 25_000;
/** Open game connections per address, and in all (3.3): a few tabs each, never a swarm. */
const MAX_CONNECTIONS_PER_ADDRESS = 8;
const MAX_CONNECTIONS = 2_000;
/**
 * Behind Railway's proxy every connection comes from the proxy; the player's address is the
 * last entry it adds to X-Forwarded-For. Only trusted there (elsewhere a client could write it).
 */
const BEHIND_PROXY =
  process.env["TRUST_PROXY"] === "1" ||
  [
    "RAILWAY_ENVIRONMENT",
    "RAILWAY_ENVIRONMENT_NAME",
    "RAILWAY_PROJECT_ID",
    "RAILWAY_SERVICE_ID",
  ].some((name) => process.env[name] !== undefined);

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
    } else if (message.type === "snapshot") events.snapshot(message.json);
    // Over: the worker keeps the final world for snapshots until stop() (3.6).
    else if (message.type === "ended") {
      events.ended(undefined, { winner: message.winner, team: message.team });
    } else if (message.type === "snapshotFailed") {
      log(`snapshot failed: ${message.message}`);
      events.snapshot(null);
    } else finish(message.message);
  });
  worker.on("error", (error) => finish(error.message));
  const post = (message: ToGameWorker) => worker.postMessage(message);
  post({ type: "start", config });
  return {
    command: (playerId, command) => post({ type: "command", playerId, command }),
    snapshot: () => post({ type: "snapshot" }),
    stop: () => {
      done = true;
      post({ type: "stop" });
      setTimeout(() => void worker.terminate(), 1_000).unref();
    },
  };
}

// --- Accounts (3.7) ------------------------------------------------------------------------

const VOLUME = process.env["RAILWAY_VOLUME_MOUNT_PATH"];
const DATA_DIR = resolve(
  process.env["DATA_DIR"] ?? VOLUME ?? fileURLToPath(new URL("../../data", import.meta.url)),
);
/** On Railway without a volume the file goes with every update: say so in /health. */
const ACCOUNTS_KEPT =
  !BEHIND_PROXY || VOLUME !== undefined || process.env["DATA_DIR"] !== undefined;
mkdirSync(DATA_DIR, { recursive: true });
const accountStore = new AccountStore(join(DATA_DIR, "accounts.sqlite"));
accountStore.pruneSessions(Date.now());
setInterval(() => accountStore.pruneSessions(Date.now()), 60 * 60 * 1000).unref();

const googleId = process.env["GOOGLE_CLIENT_ID"]?.trim();
const googleSecret = process.env["GOOGLE_CLIENT_SECRET"]?.trim();
const accountApi = new AccountApi({
  store: accountStore,
  behindProxy: BEHIND_PROXY,
  addressOf: (req) => addressOf(req),
  google: googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret } : null,
  publicOrigin: process.env["PUBLIC_ORIGIN"] ?? null,
  log,
});
log(
  `accounts in ${DATA_DIR} (${accountStore.accountCount} accounts${ACCOUNTS_KEPT ? "" : ", NOT on a volume — lost on the next update"}); Google sign-in ${accountApi.googleEnabled ? "on" : "off"}`,
);

const lobbies = new Lobbies({
  startRunner,
  newGameId: () => randomBytes(9).toString("base64url"),
  newSeed: () => randomBytes(4).readUInt32LE(0),
  log,
  accounts: {
    reserved: (name, accountId) => {
      const owner = accountStore.ownerOfName(name);
      return owner !== null && owner !== accountId;
    },
    played: (ids) => accountStore.recordGame(ids),
    won: (ids) => accountStore.recordWin(ids),
  },
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
  if (await accountApi.handle(req, res)) return;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/health") {
    const proxy = BEHIND_PROXY ? ", behind proxy" : "";
    const kept = ACCOUNTS_KEPT ? "" : " (not on a volume)";
    const google = accountApi.googleEnabled ? "on" : "off";
    res
      .writeHead(200, { "content-type": "text/plain" })
      .end(
        `ok ${lobbies.gameCount} games, ${connectionCount} connections${proxy}, accounts${kept}, Google ${google}\n`,
      );
    return;
  }
  if (url.pathname === OPEN_GAMES_PATH) {
    // The start screen's list of open public games (3.4); readable from the dev page too.
    res
      .writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      })
      .end(JSON.stringify({ games: lobbies.openGames() }));
    return;
  }
  if (url.pathname === "/debug/address") {
    // Shows callers only their own address headers: how the server tells players apart.
    const header = (name: string) => req.headers[name] ?? null;
    const report = {
      chosen: addressOf(req),
      "x-real-ip": header("x-real-ip"),
      "x-envoy-external-address": header("x-envoy-external-address"),
      "x-forwarded-for": header("x-forwarded-for"),
      socket: req.socket.remoteAddress ?? null,
    };
    res
      .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      .end(JSON.stringify(report, null, 2) + "\n");
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

/**
 * Big messages are compressed (3.5): a snapshot (~150–450 KB of JSON on a Normal map) shrinks
 * several times; turns and lobby updates stay below the threshold and go out as they are.
 */
const COMPRESS_FROM_BYTES = 16 * 1024;

const sockets = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_CLIENT_MESSAGE_BYTES,
  perMessageDeflate: { threshold: COMPRESS_FROM_BYTES },
});

const connectionsByAddress = new Map<string, number>();
let connectionCount = 0;

/**
 * The player's address. Behind the proxy, the headers its edge sets with the client's own
 * address come first (X-Real-IP, then Envoy's external address); the last X-Forwarded-For
 * entry is only a fallback (on Railway it can be an internal hop that changes per connection).
 */
function addressOf(req: IncomingMessage): string {
  if (BEHIND_PROXY) {
    for (const name of ["x-real-ip", "x-envoy-external-address"]) {
      const value = req.headers[name];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    const forwarded = req.headers["x-forwarded-for"];
    const last = typeof forwarded === "string" ? forwarded.split(",").at(-1)?.trim() : "";
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "";
}

server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://x").pathname !== SOCKET_PATH) {
    socket.destroy();
    return;
  }
  const address = addressOf(req);
  // Signed in (3.7): the session cookie comes with the upgrade, from this site's pages only.
  const account = accountApi.accountFor(req);
  const open = connectionsByAddress.get(address) ?? 0;
  if (open >= MAX_CONNECTIONS_PER_ADDRESS || connectionCount >= MAX_CONNECTIONS) {
    socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
    return;
  }
  connectionsByAddress.set(address, open + 1);
  connectionCount++;
  sockets.handleUpgrade(req, socket, head, (ws) => {
    ws.on("close", () => {
      connectionCount--;
      const left = (connectionsByAddress.get(address) ?? 1) - 1;
      if (left > 0) connectionsByAddress.set(address, left);
      else connectionsByAddress.delete(address);
    });
    accept(ws, address, account);
  });
});

function accept(ws: WebSocket, address: string, account: SignedIn | null): void {
  let alive = true;
  let windowStart = Date.now();
  let messages = 0;
  const peer = {
    send: (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    },
    sendText: (text: string) => {
      if (ws.readyState === ws.OPEN) ws.send(text);
    },
    close: (reason: string) => ws.close(1008, reason.slice(0, 100)),
  };
  const connection = lobbies.connect(peer, address, account);
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
    try {
      connection.receive(parsed);
    } catch (error) {
      // A bug handling one message closes that connection, never the whole server.
      log(
        `message error from ${address}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      peer.close("server error");
    }
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
