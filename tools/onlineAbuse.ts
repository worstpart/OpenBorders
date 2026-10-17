// Abuse check (milestone 3.3): behaves like a bad client against a running game server and
// reports how the server answered. Expected: the flood and the junk sender are closed, the
// ninth connection from one address is refused, and an honest player is unaffected.
//   node tools/onlineAbuse.ts [ws://localhost:8787/ws]
import { WebSocket } from "ws";
import { MAP_DIMENSIONS } from "../src/sim/map/generate.ts";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type OnlineSettings,
} from "../src/shared/protocol.ts";

const url = process.argv[2] ?? "ws://localhost:8787/ws";
const settings: OnlineSettings = {
  map: { seed: 3, ...MAP_DIMENSIONS.normal, style: "continent" },
  mode: "ffa",
  teams: 0,
  difficulty: "easy",
  nations: ["Avalon"],
  tribes: [],
};

function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

const send = (ws: WebSocket, m: ClientMessage | object) => ws.send(JSON.stringify(m));
const closed = (ws: WebSocket) =>
  new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve("still open after 5 s"), 5_000);
    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      resolve(`closed ${code} "${reason.toString()}"`);
    });
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function inGame(): Promise<WebSocket> {
  const ws = await open();
  send(ws, { t: "hello", version: PROTOCOL_VERSION });
  send(ws, { t: "create", settings, name: "Abuser" });
  await wait(300);
  send(ws, { t: "start" });
  await wait(1500);
  return ws;
}

// 1. A command flood: 300 commands at once.
{
  const ws = await inGame();
  const result = closed(ws);
  for (let k = 0; k < 300; k++) send(ws, { t: "command", command: { type: "confirmSpawn" } });
  console.log(`flood of 300 commands: ${await result}`);
}

// 2. Junk commands, slowly enough for the budget.
{
  const ws = await inGame();
  const result = closed(ws);
  for (let k = 0; k < 30 && ws.readyState === ws.OPEN; k++) {
    send(ws, { t: "command", command: { type: "spawn", tile: "everywhere" } });
    await wait(120);
  }
  console.log(`30 malformed commands: ${await result}`);
}

// 3. Too many connections from one address.
{
  const sockets: WebSocket[] = [];
  let refused = "";
  for (let k = 0; k < 10; k++) {
    try {
      sockets.push(await open());
    } catch (error) {
      refused = `connection ${k + 1} refused (${String(error)})`;
      break;
    }
  }
  console.log(`${sockets.length} connections open; ${refused || "none refused"}`);
  for (const ws of sockets) ws.close();
}

// 4. An oversized message.
{
  const ws = await open();
  const result = closed(ws);
  send(ws, { t: "hello", version: PROTOCOL_VERSION });
  send(ws, { t: "name", name: "x".repeat(20_000) });
  console.log(`20 KB message: ${await result}`);
}
process.exit(0);
