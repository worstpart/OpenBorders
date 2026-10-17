<script lang="ts" module>
  /** What the UI may ask the game to do (it never changes game state itself). */
  import type { HintId } from "../app/hints.ts";
  import type { MapChoice } from "../app/setup.ts";
  import type { Placeable } from "../app/buildings.ts";
  import type { LiftMode } from "../app/flights.ts";
  import type { PingKind } from "../../sim/rules.ts";
  import type { MissileKind } from "../../sim/world.ts";

  export interface AppActions {
    /** Start a game with the start screen's choices (ui.nations, ui.tribes, …). */
    play: () => void;
    /** Online (Phase 3): create a game from the start screen's choices, start it, leave it. */
    playOnline: () => void;
    startOnline: () => void;
    leaveOnline: () => void;
    renameOnline: (name: string) => void;
    readyOnline: (ready: boolean) => void;
    /** Change the map's size or type, or roll a new one (shows the loading screen meanwhile). */
    selectMap: (choice: MapChoice) => void;
    confirmSpawn: () => void;
    retreat: (attackId: number) => void;
    /** Retreat every attack on this player (0 = stop expanding). */
    retreatFrom: (target: number) => void;
    /** Attack or expand at a tile with this share (%) of home troops. */
    attackTile: (tile: number, percent: number) => void;
    /** Boats (GAME_DESIGN.md §3.18): sail for the coast nearest a tile; turn one back. */
    sendBoat: (tile: number, percent: number) => void;
    recallBoat: (boatId: number) => void;
    /** Answer an incoming attack by attacking its sender. */
    counter: (attackId: number) => void;
    /** Alliances (GAME_DESIGN.md §3.14). Asking someone who asked you accepts. */
    requestAlliance: (target: number) => void;
    replyAlliance: (from: number, accept: boolean) => void;
    renewAlliance: (ally: number) => void;
    dismissRenewal: (ally: number) => void;
    breakAlliance: (ally: number) => void;
    /** Gold (GAME_DESIGN.md §3.16): give a friend troops or gold. */
    donate: (to: number, resource: "troops" | "gold", percent: number) => void;
    /** Buildings (GAME_DESIGN.md §3.17): pick one up from the build bar to place it. */
    pickBuilding: (type: Placeable) => void;
    /** The command bar's missile launcher (D-033). */
    aimMissile: (kind: MissileKind) => void;
    upgrade: (buildingId: number) => void;
    cancelBuild: (buildingId: number) => void;
    /** Walls (GAME_DESIGN.md §3.17.6): drawn with the build bar's wall tool. */
    upgradeWall: (wallId: number) => void;
    cancelWall: (wallId: number) => void;
    /**
     * Choose where an Airport of ours airlifts to, or lands an airborne assault
     * (GAME_DESIGN.md §3.17.7).
     */
    startAirlift: (buildingId: number, mode: LiftMode) => void;
    /** Emojis and map pings (GAME_DESIGN.md §3.20). `to` 0 = everyone. */
    ping: (tile: number, kind: PingKind) => void;
    emote: (to: number, emoji: number) => void;
    /** Alert sounds: volume 0–1, mute, play one to hear the level. */
    setVolume: (volume: number) => void;
    setMuted: (muted: boolean) => void;
    testSound: () => void;
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
  import DiplomacyCards from "./hud/DiplomacyCards.svelte";
  import ContextMenu from "./hud/ContextMenu.svelte";
  import BuildingCard from "./hud/BuildingCard.svelte";
  import HintCard from "./hud/HintCard.svelte";
  import HoverCard from "./hud/HoverCard.svelte";
  import Leaderboard from "./hud/Leaderboard.svelte";
  import SpawnPrompt from "./hud/SpawnPrompt.svelte";
  import Toasts from "./hud/Toasts.svelte";
  import YouChip from "./hud/YouChip.svelte";
  import EndCard from "./screens/EndCard.svelte";
  import PauseMenu from "./screens/PauseMenu.svelte";
  import StartScreen from "./screens/StartScreen.svelte";
  import LobbyScreen from "./screens/LobbyScreen.svelte";

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
    <StartScreen
      onPlay={actions.play}
      onPlayOnline={actions.playOnline}
      onSelectMap={actions.selectMap}
    />
  </main>
{:else if ui.screen === "lobby"}
  <main class="center">
    <LobbyScreen
      onStart={actions.startOnline}
      onLeave={actions.leaveOnline}
      onRename={actions.renameOnline}
      onReady={actions.readyOnline}
    />
  </main>
{:else}
  <YouChip />
  <DiplomacyCards
    onReply={actions.replyAlliance}
    onRenew={actions.renewAlliance}
    onDismissRenewal={actions.dismissRenewal}
  />
  <Leaderboard onMenu={actions.pause} />
  <SpawnPrompt onConfirm={actions.confirmSpawn} />
  <Toasts />
  <HintCard onDismiss={actions.dismissHint} />
  <AttackChips
    onRetreat={actions.retreat}
    onCounter={actions.counter}
    onRecallBoat={actions.recallBoat}
  />
  <CommandBar onPickBuilding={actions.pickBuilding} onAimMissile={actions.aimMissile} />
  <HoverCard />
  <ContextMenu
    onAttack={actions.attackTile}
    onBoat={actions.sendBoat}
    onRetreatFrom={actions.retreatFrom}
    onRequestAlliance={actions.requestAlliance}
    onRenewAlliance={actions.renewAlliance}
    onBreakAlliance={actions.breakAlliance}
    onDonate={actions.donate}
    onPing={actions.ping}
    onEmote={actions.emote}
    onClose={actions.closeMenu}
  />
  <BuildingCard
    onUpgrade={(id, wall) => (wall ? actions.upgradeWall(id) : actions.upgrade(id))}
    onCancel={(id, wall) => (wall ? actions.cancelWall(id) : actions.cancelBuild(id))}
    onAirlift={actions.startAirlift}
    onClose={actions.closeMenu}
  />
  <EndCard onPlayAgain={actions.playAgain} />
  <PauseMenu
    onResume={actions.closeMenu}
    onSpeed={actions.setSpeed}
    onVolume={actions.setVolume}
    onMute={actions.setMuted}
    onTestSound={actions.testSound}
    onLeave={actions.playAgain}
  />
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
