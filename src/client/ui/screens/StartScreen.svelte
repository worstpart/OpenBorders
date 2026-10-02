<script lang="ts">
  import {
    clampLobby,
    landPerPlayer,
    MAP_SIZES,
    MAX_NATIONS,
    MAX_OPPONENTS,
    TRIBE_PRESETS,
    type MapSize,
  } from "../../app/setup.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { DIFFICULTIES, type Difficulty } from "../../../sim/rules.ts";

  interface Props {
    onPlay: () => void;
    onSelectMap: (size: MapSize) => void;
  }

  let { onPlay, onSelectMap }: Props = $props();
  let starting = $state(false);
  const opponents = $derived(ui.nations + ui.tribes);
  const perPlayer = $derived(landPerPlayer(ui.landTiles, opponents));
  const crowded = $derived(ui.mapSize === "normal" && opponents >= 50);

  function setLobby(nations: number, tribes: number): void {
    const lobby = clampLobby(nations, tribes);
    ui.nations = lobby.nations;
    ui.tribes = lobby.tribes;
  }

  const DIFFICULTY_LABEL: Record<Difficulty, string> = {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
  };

  function play(): void {
    if (starting) return;
    starting = true;
    onPlay();
  }
</script>

{#snippet stepper(label: string, value: number, min: number, max: number, set: (v: number) => void)}
  <div class="stepper" role="group" aria-label={label}>
    <button
      type="button"
      aria-label="Fewer {label.toLowerCase()}"
      disabled={value <= min}
      onclick={() => set(value - 1)}>−</button
    >
    <output aria-live="polite">{value}</output>
    <button
      type="button"
      aria-label="More {label.toLowerCase()}"
      disabled={value >= max}
      onclick={() => set(value + 1)}>+</button
    >
  </div>
{/snippet}

<section class="card" aria-labelledby="title">
  <h1 id="title">OpenBorder</h1>
  <p class="tagline">Start small. Expand. Outlast everyone.</p>

  <div class="row">
    <span title="Smart opponents — the real rivals">Nations</span>
    {@render stepper(
      "Nations",
      ui.nations,
      ui.tribes > 0 ? 0 : 1,
      Math.min(MAX_NATIONS, MAX_OPPONENTS - ui.tribes),
      (v) => setLobby(v, ui.tribes),
    )}
  </div>
  <div class="row">
    <span title="Weak filler bots: fewer troops, slower growth, cheap to conquer">Tribes</span>
    {@render stepper("Tribes", ui.tribes, ui.nations > 0 ? 0 : 1, MAX_OPPONENTS - ui.nations, (v) =>
      setLobby(ui.nations, v),
    )}
  </div>
  <div class="segmented presets" role="group" aria-label="Quick pick: tribes">
    {#each TRIBE_PRESETS as preset (preset)}
      <button
        type="button"
        aria-pressed={ui.tribes === preset}
        onclick={() => setLobby(ui.nations, preset)}>{preset}</button
      >
    {/each}
  </div>

  <div class="row">
    <span id="difficulty-label">Nations play</span>
    <div class="segmented" role="group" aria-labelledby="difficulty-label">
      {#each DIFFICULTIES as difficulty (difficulty)}
        <button
          type="button"
          aria-pressed={ui.difficulty === difficulty}
          onclick={() => (ui.difficulty = difficulty)}>{DIFFICULTY_LABEL[difficulty]}</button
        >
      {/each}
    </div>
  </div>

  <div class="row">
    <span id="map-label">Map</span>
    <div class="segmented" role="group" aria-labelledby="map-label">
      {#each Object.entries(MAP_SIZES) as [size, info] (size)}
        <button
          type="button"
          aria-pressed={ui.mapSize === size}
          onclick={() => onSelectMap(size as MapSize)}>{info.label}</button
        >
      {/each}
    </div>
  </div>
  <p class="info" class:warn={crowded}>
    {opponents} opponents · ≈ {perPlayer.toLocaleString("en-US")} tiles of land each{#if crowded}&nbsp;·
      a Large map gives big lobbies more room{/if}
  </p>

  <button type="button" class="play" onclick={play} disabled={starting}>
    {starting ? "Starting…" : "Play"}
  </button>
  <p class="note">Phase 2 prototype</p>
</section>

<style>
  .card {
    pointer-events: auto;
    width: min(360px, calc(100vw - 32px));
    padding: var(--space-8) var(--space-8) var(--space-6);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: var(--text-display);
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .tagline {
    margin: var(--space-1) 0 var(--space-6);
    color: var(--text-secondary);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
    color: var(--text-secondary);
  }

  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-control);
    background: rgb(255 255 255 / 0.06);
  }

  .segmented button {
    flex: 1;
    min-width: 56px;
    height: 28px;
    border: none;
    border-radius: calc(var(--radius-control) - 2px);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .segmented button:hover {
    background: rgb(255 255 255 / 0.08);
  }

  .segmented button[aria-pressed="true"] {
    background: rgb(255 255 255 / 0.16);
    color: var(--text-primary);
    font-weight: 600;
  }

  .presets {
    margin-bottom: var(--space-4);
  }

  .info {
    margin: 0 0 var(--space-4);
    min-height: 2.6em;
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-align: left;
  }

  .info.warn {
    color: var(--color-warning);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .stepper button {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-control);
    border: 1px solid var(--surface-hairline);
    background: rgb(255 255 255 / 0.06);
    color: var(--text-primary);
    font-size: var(--text-lg);
    line-height: 1;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .stepper button:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.12);
  }

  .stepper button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  output {
    min-width: 2.5ch;
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .play {
    width: 100%;
    height: 44px;
    border: none;
    border-radius: var(--radius-control);
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-size: var(--text-lg);
    font-weight: 650;
    cursor: pointer;
    transition:
      filter var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  .play:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .play:active:not(:disabled) {
    transform: translateY(1px);
  }

  .play:disabled {
    opacity: 0.7;
    cursor: progress;
  }

  .note {
    margin: var(--space-4) 0 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
