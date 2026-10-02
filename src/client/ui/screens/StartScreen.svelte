<script lang="ts">
  import { MAX_OPPONENTS } from "../../app/players.ts";

  interface Props {
    onPlay: (opponents: number) => void;
  }

  let { onPlay }: Props = $props();
  let opponents = $state(7);
  let starting = $state(false);

  function play(): void {
    if (starting) return;
    starting = true;
    onPlay(opponents);
  }
</script>

<section class="card" aria-labelledby="title">
  <h1 id="title">Borderline</h1>
  <p class="tagline">Start small. Expand. Outlast everyone.</p>

  <div class="opponents">
    <span id="opponents-label">Opponents</span>
    <div class="stepper" role="group" aria-labelledby="opponents-label">
      <button
        type="button"
        aria-label="Fewer opponents"
        disabled={opponents <= 1}
        onclick={() => (opponents = Math.max(1, opponents - 1))}>−</button
      >
      <output aria-live="polite">{opponents}</output>
      <button
        type="button"
        aria-label="More opponents"
        disabled={opponents >= MAX_OPPONENTS}
        onclick={() => (opponents = Math.min(MAX_OPPONENTS, opponents + 1))}>+</button
      >
    </div>
  </div>

  <button type="button" class="play" onclick={play} disabled={starting}>
    {starting ? "Starting…" : "Play"}
  </button>
  <p class="note">Working title · Phase 1 prototype</p>
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

  .opponents {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-4);
    color: var(--text-secondary);
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
