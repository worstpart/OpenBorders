import { mount } from "svelte";
import { MapRenderer } from "./render/renderer.ts";
import App from "./ui/App.svelte";
import "./ui/tokens.css";

function requireElement<T extends Element>(selector: string, type: new () => T): T {
  const element = document.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Missing element ${selector} in index.html`);
  return element;
}

const canvas = requireElement("#map", HTMLCanvasElement);
const uiRoot = requireElement("#ui", HTMLDivElement);

let fatalError: string | null = null;
try {
  const renderer = new MapRenderer(canvas);
  renderer.setClearColor(
    getComputedStyle(document.documentElement).getPropertyValue("--world-background"),
  );
} catch (error) {
  fatalError = error instanceof Error ? error.message : String(error);
  console.error(error);
}

mount(App, { target: uiRoot, props: { fatalError } });
