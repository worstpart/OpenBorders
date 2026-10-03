import { mount } from "svelte";
import { GameClient } from "./app/client.ts";
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
      selectMap: (size) => {
        if (size === ui.mapSize) return;
        ui.mapSize = size;
        loadMap();
      },
      confirmSpawn: () => client?.confirmSpawn(),
      retreat: (attackId) => client?.retreat(attackId),
      retreatFrom: (target) => client?.retreatFrom(target),
      attackTile: (tile, percent) => client?.attackTile(tile, percent),
      counter: (attackId) => client?.counter(attackId),
      requestAlliance: (target) => client?.requestAlliance(target),
      replyAlliance: (from, accept) => client?.replyAlliance(from, accept),
      renewAlliance: (ally) => client?.renewAlliance(ally),
      dismissRenewal: (ally) => client?.dismissRenewal(ally),
      breakAlliance: (ally) => client?.breakAlliance(ally),
      mobilize: () => client?.mobilize(),
      donate: (to, resource, percent) => client?.donate(to, resource, percent),
      pickBuilding: (type) => client?.pickBuilding(type),
      upgrade: (buildingId) => client?.upgrade(buildingId),
      cancelBuild: (buildingId) => client?.cancelBuild(buildingId),
      upgradeWall: (wallId) => client?.upgradeWall(wallId),
      cancelWall: (wallId) => client?.cancelWall(wallId),
      pause: () => client?.pause(),
      closeMenu: () => client?.closeMenu(),
      setSpeed: (multiplier) => client?.setSpeed(multiplier),
      dismissHint: (id) => client?.dismissHint(id),
      playAgain: () => client?.backToStart(),
    },
  },
});

/** Generating a map blocks for 0.5–1 s, so the loading screen paints first. */
function loadMap(): void {
  ui.screen = "loading";
  requestAnimationFrame(() =>
    setTimeout(() => {
      try {
        client?.loadMap(ui.mapSize);
      } catch (error) {
        reportFatal(error);
      }
    }, 0),
  );
}

loadMap();
