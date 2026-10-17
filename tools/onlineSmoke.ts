// Online smoke test (milestone 3.1): two scripted browsers against a running game server.
// One creates a game, the other joins by its id, the creator starts it; both run their own
// simulation from the server's turns and compare their state hash with the server's after
// every tick. Each player spawns and expands, so commands really travel.
//   npm start            (in another terminal)
//   node tools/onlineSmoke.ts [ws://localhost:8787/ws] [ticks=300]
import { WebSocket } from "ws";
import type { Command } from "../src/sim/commands.ts";
import { isLand } from "../src/sim/map/gameMap.ts";
import { generateMap, MAP_DIMENSIONS } from "../src/sim/map/generate.ts";
import { runTick } from "../src/sim/tick.ts";
import { createWorld, type World } from "../src/sim/world.ts";
import {
  ONLINE_RULES,
  PROTOCOL_VERSION,
  type ClientMessage,
  type OnlineSettings,
  type ServerMessage,
} from "../src/shared/protocol.ts";

const url = process.argv[2] ?? "ws://localhost:8787/ws";
const TICKS = Number(process.argv[3] ?? 300);

const settings: OnlineSettings = {
  map: { seed: 7, ...MAP_DIMENSIONS.normal, style: "archipelago" },
  mode: "ffa",
  teams: 0,
  difficulty: "medium",
  nations: ["Avalon", "Borea", "Corvia", "Dunmar"],
  tribes: ["Ash", "Birch", "Cedar"],
};

interface Bot {
  name: string;
  ws: WebSocket;
  world: World | null;
  playerId: number;
  checked: number;
  mismatches: number;
  started: Promise<void>;
  done: Promise<void>;
}

function connect(
  name: string,
  onLobby: (lobby: Extract<ServerMessage, { t: "lobby" }>, bot: Bot) => void,
): Bot {
  const ws = new WebSocket(url);
  let resolveStarted!: () => void;
  let resolveDone!: () => void;
  let rejectDone!: (e: Error) => void;
  const bot: Bot = {
    name,
    ws,
    world: null,
    playerId: 0,
    checked: 0,
    mismatches: 0,
    started: new Promise((r) => (resolveStarted = r)),
    done: new Promise((r, j) => ((resolveDone = r), (rejectDone = j))),
  };
  const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
  ws.on("open", () => send({ t: "hello", version: PROTOCOL_VERSION }));
  ws.on("close", (code, reason) =>
    rejectDone(new Error(`${name}: closed ${code} ${reason.toString()}`)),
  );
  ws.on("message", (data) => {
    const m = JSON.parse(data.toString()) as ServerMessage;
    if (m.t === "error") rejectDone(new Error(`${name}: ${m.message}`));
    if (m.t === "lobby") onLobby(m, bot);
    if (m.t === "start") {
      bot.playerId = m.playerId;
      bot.world = createWorld({
        seed: m.config.seed,
        map: generateMap(m.config.map),
        players: m.config.players,
        rules: ONLINE_RULES,
      });
      resolveStarted();
    }
    if (m.t === "turn" && bot.world) {
      const frame = runTick(bot.world, { tick: m.tick, commands: m.commands });
      bot.checked++;
      if (frame.hash !== m.hash) bot.mismatches++;
      for (const c of script(bot.world, bot.playerId)) send({ t: "command", command: c });
      if (m.tick >= TICKS) resolveDone();
    }
  });
  return bot;
}

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

const start = performance.now();
let joiner: Bot | null = null;
// The joiner presses Ready on joining; the creator starts once it sees everyone ready.
let started = false;
const creator = connect("creator", (lobby, bot) => {
  if (!joiner) {
    const gameId = lobby.gameId;
    console.log(`created game ${gameId} as "${lobby.players[0]?.name}"`);
    joiner = connect("joiner", (_lobby, j) => {
      if (!j.playerId)
        j.ws.send(JSON.stringify({ t: "ready", ready: true } satisfies ClientMessage));
    });
    joiner.ws.on("open", () =>
      joiner!.ws.send(
        JSON.stringify({ t: "join", gameId, name: "Smoke Joiner" } satisfies ClientMessage),
      ),
    );
  } else if (!started && lobby.players.length === 2 && lobby.players.every((p) => p.ready)) {
    started = true;
    console.log(`lobby: ${lobby.players.map((p) => p.name).join(", ")} — all ready, starting`);
    bot.ws.send(JSON.stringify({ t: "start" } satisfies ClientMessage));
  }
});
creator.ws.on("open", () =>
  creator.ws.send(
    JSON.stringify({ t: "create", settings, name: "Smoke Creator" } satisfies ClientMessage),
  ),
);

const timeout = setTimeout(() => {
  console.error("timed out");
  process.exit(1);
}, 120_000);
await creator.started;
await joiner!.started;
console.log(`started: creator is player ${creator.playerId}, joiner is player ${joiner!.playerId}`);
try {
  await Promise.all([creator.done, joiner!.done]);
} catch (error) {
  console.error(String(error));
  process.exit(1);
}
clearTimeout(timeout);
for (const bot of [creator, joiner!]) {
  const p = bot.world!.players[bot.playerId - 1]!;
  console.log(
    `${bot.name}: ${bot.checked} turns, ${bot.mismatches} hash mismatches, owns ${p.tiles} tiles (phase ${bot.world!.phase})`,
  );
}
console.log(`${((performance.now() - start) / 1000).toFixed(1)} s`);
creator.ws.close();
joiner!.ws.close();
process.exit(creator.mismatches + joiner!.mismatches === 0 ? 0 : 1);
