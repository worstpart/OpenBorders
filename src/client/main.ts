import { mount } from "svelte";
import { GameClient } from "./app/client.ts";
import { rollMapSeed } from "./app/setup.ts";
import { ui } from "./app/uiState.svelte.ts";
import App from "./ui/App.svelte";
import "./ui/tokens.css";

function requireElement<T extends Element>(selector: string, type: new () => T): T {
  const element = document.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Missing element ${selector} in index.html`);
  return element;
}

function reportFatal(error: unknown): void {
  console.error(error);
  ui.fatalError = error instanceof Error ? error.message : String(error);
}

let client: GameClient | null = null;
try {
  client = new GameClient({
    mapCanvas: requireElement("#map", HTMLCanvasElement),
    labelCanvas: requireElement("#labels", HTMLCanvasElement),
    overlayParent: document.body,
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim(),
  });
} catch (error) {
  reportFatal(error);
}

if (import.meta.env.DEV && client) {
  (window as unknown as { __openborder: GameClient["debug"] }).__openborder = client.debug;
}

mount(App, {
  target: requireElement("#ui", HTMLDivElement),
  props: {
    actions: {
      play: () =>
        client
          ?.startGame({
            nations: ui.nations,
            tribes: ui.tribes,
            difficulty: ui.difficulty,
            mode: ui.mode,
            teams: ui.teams,
          })
          .catch(reportFatal),
      playOnline: () =>
        client?.playOnline({
          nations: ui.nations,
          tribes: ui.tribes,
          difficulty: ui.difficulty,
          mode: ui.mode,
          teams: ui.teams,
        }),
      startOnline: () => client?.startOnline(),
      leaveOnline: () => {
        history.replaceState(null, "", location.pathname);
        client?.leaveOnline();
      },
      selectMap: (choice) => {
        if (!choice.newSeed && (choice.size ?? ui.mapSize) === ui.mapSize) {
          if ((choice.style ?? ui.mapStyle) === ui.mapStyle) return;
        }
        if (choice.size) ui.mapSize = choice.size;
        if (choice.style) ui.mapStyle = choice.style;
        if (choice.newSeed) {
          ui.mapSeed = rollMapSeed(() => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32);
        }
        loadMap();
      },
      confirmSpawn: () => client?.confirmSpawn(),
      retreat: (attackId) => client?.retreat(attackId),
      retreatFrom: (target) => client?.retreatFrom(target),
      attackTile: (tile, percent) => client?.attackTile(tile, percent),
      sendBoat: (tile, percent) => client?.sendBoat(tile, percent),
      recallBoat: (boatId) => client?.recallBoat(boatId),
      counter: (attackId) => client?.counter(attackId),
      requestAlliance: (target) => client?.requestAlliance(target),
      replyAlliance: (from, accept) => client?.replyAlliance(from, accept),
      renewAlliance: (ally) => client?.renewAlliance(ally),
      dismissRenewal: (ally) => client?.dismissRenewal(ally),
      breakAlliance: (ally) => client?.breakAlliance(ally),
      donate: (to, resource, percent) => client?.donate(to, resource, percent),
      pickBuilding: (type) => client?.pickBuilding(type),
      aimMissile: (kind) => client?.aimMissile(kind),
      upgrade: (buildingId) => client?.upgrade(buildingId),
      cancelBuild: (buildingId) => client?.cancelBuild(buildingId),
      upgradeWall: (wallId) => client?.upgradeWall(wallId),
      cancelWall: (wallId) => client?.cancelWall(wallId),
      startAirlift: (buildingId, mode) => client?.startAirlift(buildingId, mode),
      ping: (tile, kind) => client?.ping(tile, kind),
      emote: (to, emoji) => client?.emote(to, emoji),
      setVolume: (volume) => client?.setVolume(volume),
      setMuted: (muted) => client?.setMuted(muted),
      testSound: () => client?.testSound(),
      pause: () => client?.pause(),
      closeMenu: () => client?.closeMenu(),
      setSpeed: (multiplier) => client?.setSpeed(multiplier),
      dismissHint: (id) => client?.dismissHint(id),
      playAgain: () => client?.backToStart(),
    },
  },
});

/** Maps are generated in a worker (0.5–2.5 s); the loading screen shows meanwhile. */
function loadMap(): void {
  // The first map shows the loading screen; later ones keep the start screen up.
  if (ui.screen !== "start") ui.screen = "loading";
  ui.mapLoading = true;
  client?.loadMap({ size: ui.mapSize, style: ui.mapStyle, seed: ui.mapSeed }).catch(reportFatal);
}

loadMap();

// A shared online-game link (Phase 3): ?game=<id> opens that game's lobby.
const gameId = new URLSearchParams(location.search).get("game");
if (gameId) client?.joinOnline(gameId);
