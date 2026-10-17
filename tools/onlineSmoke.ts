// Online smoke test (milestones 3.1, 3.5): scripted browsers against a running game server.
// One creates a game, the other joins by its id, the creator starts it; both run their own
// simulation from the server's turns and compare their state hash with the server's after
// every tick. Each player spawns and expands, so commands really travel. Then (3.5):
//   - the creator corrupts its own world on purpose: it must notice, ask for a snapshot and
//     run in step again;
//   - a spectator joins mid-game by the link and must stay in step from its snapshot;
//   - the joiner's connection drops: it reconnects with its rejoin token, gets its country
//     back from a snapshot and keeps playing.
//   npm start            (in another terminal)
//   node tools/onlineSmoke.ts [ws://localhost:8787/ws] [ticks=300]
import { WebSocket } from "ws";
import type { Command } from "../src/sim/commands.ts";
import { isLand, type GameMap } from "../src/sim/map/gameMap.ts";
import { generateMap, MAP_DIMENSIONS } from "../src/sim/map/generate.ts";
import { deserializeWorld } from "../src/sim/snapshot.ts";
import { runTick } from "../src/sim/tick.ts";
import { createWorld, setOwner, type World } from "../src/sim/world.ts";
import {
  ONLINE_RULES,
  PROTOCOL_VERSION,
  type ClientMessage,
  type GameConfig,
  type OnlineSettings,
  type ServerMessage,
} from "../src/shared/protocol.ts";

const url = process.argv[2] ?? "ws://localhost:8787/ws";
const TICKS = Number(process.argv[3] ?? 300);
const CORRUPT_AT = Math.round(TICKS * 0.3);
const WATCH_AT = Math.round(TICKS * 0.4);
const DROP_AT = Math.round(TICKS * 0.5);

const settings: OnlineSettings = {
  map: { seed: 7, ...MAP_DIMENSIONS.normal, style: "archipelago" },
  mode: "ffa",
  teams: 0,
  difficulty: "medium",
  nations: ["Avalon", "Borea", "Corvia", "Dunmar"],
  tribes: ["Ash", "Birch", "Cedar"],
};

/** Maps by spec, generated once (every client of the game has the same one). */
const maps = new Map<string, GameMap>();
const mapOf = (config: GameConfig) => {
  const key = JSON.stringify(config.map);
  if (!maps.has(key)) maps.set(key, generateMap(config.map));
  return maps.get(key)!;
};

interface Client {
  readonly name: string;
  ws: WebSocket;
  world: World | null;
  config: GameConfig | null;
  gameId: string;
  playerId: number;
  token: string;
  /** Waiting for a snapshot: turns are dropped. */
  syncing: boolean;
  checked: number;
  /** Turns whose hash differed (each starts a repair). */
  mismatches: number;
  snapshots: number;
  snapshotBytes: number;
  lastTick: number;
  started: Promise<void>;
  done: Promise<void>;
  onTick?: (client: Client) => void;
}

const send = (c: Client, m: ClientMessage) => c.ws.send(JSON.stringify(m));

function client(name: string, first: ClientMessage | null, onLobby?: LobbyHandler): Client {
  let resolveStarted!: () => void;
  let resolveDone!: () => void;
  let rejectDone!: (e: Error) => void;
  const c: Client = {
    name,
    ws: null as unknown as WebSocket,
    world: null,
    config: null,
    gameId: "",
    playerId: 0,
    token: "",
    syncing: false,
    checked: 0,
    mismatches: 0,
    snapshots: 0,
    snapshotBytes: 0,
    lastTick: 0,
    started: new Promise((r) => (resolveStarted = r)),
    done: new Promise((r, j) => ((resolveDone = r), (rejectDone = j))),
  };
  c.done.catch(() => {});
  const connectWith = (message: ClientMessage | null) => {
    const ws = new WebSocket(url);
    c.ws = ws;
    ws.on("open", () => {
      send(c, { t: "hello", version: PROTOCOL_VERSION });
      if (message) send(c, message);
    });
    ws.on("close", (code, reason) => {
      if (ws === c.ws && !(c as { dropping?: boolean }).dropping)
        rejectDone(new Error(`${name}: closed ${code} ${reason.toString()}`));
    });
    ws.on("message", (data) => {
      if (ws !== c.ws) return;
      const text = data.toString();
      const m = JSON.parse(text) as ServerMessage;
      if (m.t === "error") rejectDone(new Error(`${name}: ${m.message}`));
      if (m.t === "lobby") onLobby?.(m, c);
      if (m.t === "start") {
        c.gameId = m.gameId;
        c.playerId = m.playerId;
        c.token = m.rejoin;
        c.config = m.config;
        if (!c.world) {
          c.world = createWorld({
            seed: m.config.seed,
            map: mapOf(m.config),
            players: m.config.players,
            rules: ONLINE_RULES,
          });
        }
        c.syncing = m.midGame;
        resolveStarted();
      }
      if (m.t === "sync" && c.config) {
        c.world = deserializeWorld(m.snapshot, mapOf(c.config), ONLINE_RULES);
        c.lastTick = m.snapshot.tick;
        c.syncing = false;
        c.snapshots++;
        c.snapshotBytes = Math.max(c.snapshotBytes, text.length);
      }
      if (m.t === "turn" && c.world && !c.syncing) {
        if (m.tick !== c.lastTick + 1) {
          rejectDone(new Error(`${name}: turn ${m.tick} after ${c.lastTick}`));
          return;
        }
        c.lastTick = m.tick;
        const frame = runTick(c.world, { tick: m.tick, commands: m.commands });
        c.checked++;
        if (frame.hash !== m.hash) {
          c.mismatches++;
          c.syncing = true;
          send(c, { t: "desync", tick: m.tick });
          return;
        }
        if (c.playerId > 0) {
          for (const command of script(c.world, c.playerId)) send(c, { t: "command", command });
        }
        c.onTick?.(c);
        if (m.tick >= TICKS) resolveDone();
      }
    });
  };
  (c as { reconnect?: (m: ClientMessage | null) => void }).reconnect = connectWith;
  connectWith(first);
  return c;
}

type LobbyHandler = (lobby: Extract<ServerMessage, { t: "lobby" }>, c: Client) => void;

/** Spawn on free land at tick 3, confirm, then expand into neutral land every 30 ticks. */
function script(world: World, me: number): Command[] {
  const player = world.players[me - 1]!;
  if (world.tick === 3 + me) {
    for (let t = Math.floor(world.owner.length * (me / 3)); t < world.owner.length; t++) {
      if (isLand(world.map, t) && world.owner[t] === 0) return [{ type: "spawn", tile: t }];
    }
  }
  if (world.tick === 10) return [{ type: "confirmSpawn" }];
  if (world.phase !== "playing" || world.tick % 30 !== 0) return [];
  const width = world.map.width;
  for (const tile of player.border) {
    for (const n of [tile - 1, tile + 1, tile - width, tile + width]) {
      if (n >= 0 && n < world.owner.length && world.owner[n] === 0 && isLand(world.map, n)) {
        return [{ type: "attack", target: 0, focusTile: n, percentBp: 5_000 }];
      }
    }
  }
  return [];
}

/** Makes a world differ on purpose: a square of land changes hands. */
function corrupt(world: World): void {
  const { width, height } = world.map;
  for (let y = (height >> 1) - 10; y < (height >> 1) + 10; y++) {
    for (let x = (width >> 1) - 10; x < (width >> 1) + 10; x++) {
      const tile = y * width + x;
      if (isLand(world.map, tile)) setOwner(world, tile, 1);
    }
  }
}

const start = performance.now();
let joiner = null as Client | null;
// Set from a callback (TypeScript would otherwise narrow it to null below).
let watcher = null as Client | null;
let started = false;
const reconnectOf = (c: Client) =>
  (c as unknown as { reconnect: (m: ClientMessage | null) => void }).reconnect;

const creator = client("creator", { t: "create", settings, name: "Smoke Creator" }, (lobby, c) => {
  if (!joiner) {
    const gameId = lobby.gameId;
    console.log(`created game ${gameId} as "${lobby.players[0]?.name}"`);
    joiner = client("joiner", { t: "join", gameId, name: "Smoke Joiner" }, (_lobby, j) => {
      if (!j.playerId) send(j, { t: "ready", ready: true });
    });
  } else if (!started && lobby.players.length === 2 && lobby.players.every((p) => p.ready)) {
    started = true;
    console.log(`lobby: ${lobby.players.map((p) => p.name).join(", ")} — all ready, starting`);
    send(c, { t: "start" });
  }
});

// 3.5 checks, driven by the creator's ticks.
let corruptedAt = 0;
let dropped = false;
creator.onTick = (c) => {
  if (c.lastTick === CORRUPT_AT && !corruptedAt) {
    corruptedAt = c.lastTick;
    corrupt(c.world!);
    console.log(`tick ${c.lastTick}: creator corrupts its own world`);
  }
  if (c.lastTick === WATCH_AT && !watcher) {
    console.log(`tick ${c.lastTick}: a spectator opens the link`);
    watcher = client("watcher", { t: "join", gameId: c.gameId, name: "Smoke Watcher" });
  }
  if (c.lastTick === DROP_AT && joiner && !dropped) {
    dropped = true;
    const j = joiner;
    console.log(`tick ${c.lastTick}: the joiner's connection drops; it rejoins in 1 s`);
    (j as { dropping?: boolean }).dropping = true;
    j.ws.terminate();
    j.syncing = true;
    setTimeout(() => {
      (j as { dropping?: boolean }).dropping = false;
      reconnectOf(j)({ t: "rejoin", gameId: j.gameId, token: j.token });
    }, 1_000);
  }
};

const timeout = setTimeout(() => {
  console.error("timed out");
  process.exit(1);
}, 180_000);
await creator.started;
await joiner!.started;
console.log(`started: creator is player ${creator.playerId}, joiner is player ${joiner!.playerId}`);
let failed = false;
try {
  await Promise.all([creator.done, joiner!.done]);
  while (!watcher) await new Promise((r) => setTimeout(r, 100));
  await watcher.done;
} catch (error) {
  console.error(String(error));
  failed = true;
}
clearTimeout(timeout);
for (const c of [creator, joiner!, watcher].filter((x): x is Client => x !== null)) {
  const p = c.playerId > 0 ? c.world!.players[c.playerId - 1]! : null;
  console.log(
    `${c.name}: ${c.checked} turns, ${c.mismatches} hash mismatches, ${c.snapshots} snapshots` +
      (c.snapshotBytes ? ` (largest ${(c.snapshotBytes / 1024).toFixed(0)} KB of JSON)` : "") +
      (p ? `, owns ${p.tiles} tiles` : ", watching") +
      ` (tick ${c.lastTick}, phase ${c.world?.phase})`,
  );
}
console.log(`${((performance.now() - start) / 1000).toFixed(1)} s`);
// Expected: the creator drifts once (on purpose) and is repaired; the joiner gets one
// snapshot (its rejoin), the watcher one; nobody else ever differs.
const ok =
  !failed &&
  creator.mismatches === 1 &&
  creator.snapshots === 1 &&
  joiner!.mismatches === 0 &&
  joiner!.snapshots === 1 &&
  watcher !== null &&
  (watcher as Client).mismatches === 0 &&
  (watcher as Client).snapshots === 1;
console.log(ok ? "OK" : "FAILED");
for (const c of [creator, joiner!, watcher]) c?.ws.close();
process.exit(ok ? 0 : 1);
