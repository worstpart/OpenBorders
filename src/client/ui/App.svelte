<script lang="ts" module>
  /** What the UI may ask the game to do (it never changes game state itself). */
  import type { HintId } from "../app/hints.ts";
  import type { MapSize } from "../app/setup.ts";

  export interface AppActions {
    /** Start a game with the start screen's choices (ui.nations, ui.tribes, …). */
    play: () => void;
    /** Generate the map of this size (shows the loading screen meanwhile). */
    selectMap: (size: MapSize) => void;
    confirmSpawn: () => void;
    retreat: (attackId: number) => void;
    /** Retreat every attack on this player (0 = stop expanding). */
    retreatFrom: (target: number) => void;
    /** Attack or expand at a tile with this share (%) of home troops. */
    attackTile: (tile: number, percent: number) => void;
    /** Answer an incoming attack by attacking its sender. */
    counter: (attackId: number) => void;
    pause: () => void;
    closeMenu: () => void;
    setSpeed: (multiplier: number) => void;
    dismissHint: (id: HintId) => void;
    playAgain: () => void;
  }
</script>

<script lang="ts">
  import { ui } from "../app/uiState.svelte.ts";
  import AttackChips from "./hud/AttackChips.svelte";
  import CommandBar from "./hud/CommandBar.svelte";
  import ContextMenu from "./hud/ContextMenu.svelte";
  import HintCard from "./hud/HintCard.svelte";
  import HoverCard from "./hud/HoverCard.svelte";
  import Leaderboard from "./hud/Leaderboard.svelte";
  import SpawnPrompt from "./hud/SpawnPrompt.svelte";
  import Toasts from "./hud/Toasts.svelte";
  import YouChip from "./hud/YouChip.svelte";
  import EndCard from "./screens/EndCard.svelte";
  import PauseMenu from "./screens/PauseMenu.svelte";
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
    <StartScreen onPlay={actions.play} onSelectMap={actions.selectMap} />
  </main>
{:else}
  <YouChip />
  <Leaderboard onMenu={actions.pause} />
  <SpawnPrompt onConfirm={actions.confirmSpawn} />
  <Toasts />
  <HintCard onDismiss={actions.dismissHint} />
  <AttackChips onRetreat={actions.retreat} onCounter={actions.counter} />
  <CommandBar />
  <HoverCard />
  <ContextMenu
    onAttack={actions.attackTile}
    onRetreatFrom={actions.retreatFrom}
    onClose={actions.closeMenu}
  />
  <EndCard onPlayAgain={actions.playAgain} />
  <PauseMenu onResume={actions.closeMenu} onSpeed={actions.setSpeed} onLeave={actions.playAgain} />
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
