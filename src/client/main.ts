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
  (window as unknown as { __borderline: GameClient["debug"] }).__borderline = client.debug;
}

mount(App, {
  target: requireElement("#ui", HTMLDivElement),
  props: {
    actions: {
      play: (opponents) => client?.startGame(opponents).catch(reportFatal),
      confirmSpawn: () => client?.confirmSpawn(),
      retreat: (attackId) => client?.retreat(attackId),
      playAgain: () => client?.backToStart(),
    },
  },
});

// Generating the map blocks for about half a second, so let the loading screen paint first.
requestAnimationFrame(() =>
  setTimeout(() => {
    try {
      client?.loadMap();
    } catch (error) {
      reportFatal(error);
    }
  }, 0),
);
