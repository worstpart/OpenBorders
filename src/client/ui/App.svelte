<script lang="ts" module>
  /** What the UI may ask the game to do (it never changes game state itself). */
  export interface AppActions {
    play: (opponents: number) => void;
    confirmSpawn: () => void;
    retreat: (attackId: number) => void;
    playAgain: () => void;
  }
</script>

<script lang="ts">
  import { ui } from "../app/uiState.svelte.ts";
  import AttackChips from "./hud/AttackChips.svelte";
  import SpawnPrompt from "./hud/SpawnPrompt.svelte";
  import YouChip from "./hud/YouChip.svelte";
  import EndCard from "./screens/EndCard.svelte";
  import StartScreen from "./screens/StartScreen.svelte";

  interface Props {
    actions: AppActions;
  }

  let { actions }: Props = $props();
</script>

{#if ui.fatalError}
  <main class="center">
    <section class="card" role="alert">
      <h1>Can't start the game</h1>
      <p>{ui.fatalError}</p>
    </section>
  </main>
{:else if ui.screen === "loading"}
  <main class="center">
    <p class="loading" role="status">Generating the map…</p>
  </main>
{:else if ui.screen === "start"}
  <main class="center">
    <StartScreen onPlay={actions.play} />
  </main>
{:else}
  <YouChip />
  <SpawnPrompt onConfirm={actions.confirmSpawn} />
  <AttackChips onRetreat={actions.retreat} />
  <EndCard onPlayAgain={actions.playAgain} />
{/if}

<style>
  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--space-4);
  }

  .card {
    pointer-events: auto;
    max-width: 420px;
    padding: var(--space-6) var(--space-8);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: var(--text-lg);
    color: var(--color-danger);
  }

  p {
    margin: var(--space-3) 0 0;
    line-height: 1.5;
  }

  .loading {
    color: var(--text-secondary);
  }
</style>
