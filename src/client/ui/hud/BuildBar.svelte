<script lang="ts">
  /**
   * The build bar (GAME_DESIGN.md §3.17.13), the bottom row of the command bar: one tile per
   * building with its price. Clicking one picks it up — it follows the mouse until a click
   * on your land places it; right-click or Esc puts it back.
   */
  import { buildBarItems, wallPreview, type Placeable } from "../../app/buildings.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatTroops } from "../../format.ts";
  import BuildingIcon from "./BuildingIcon.svelte";
  import { DEFAULT_RULES } from "../../../sim/rules.ts";
  import { airliftTroops } from "../../../sim/systems/flights.ts";

  interface Props {
    onPick: (type: Placeable) => void;
  }

  let { onPick }: Props = $props();

  const items = $derived(ui.screen === "game" ? buildBarItems(ui.buildContext) : []);
  const placing = $derived(items.find((i) => i.type === ui.placing) ?? null);
  // Choosing where an Airport airlifts to, or lands an airborne assault (GAME_DESIGN.md §3.17.7).
  const airlift = $derived.by(() => {
    const airport = ui.buildings.find((b) => b.id === ui.airliftFrom);
    if (!airport || !ui.me) return null;
    return {
      mode: ui.liftMode,
      troops: airliftTroops(
        DEFAULT_RULES,
        airport.level,
        ui.me,
        Math.round(ui.attackPercent * 100),
      ),
    };
  });
  // Drawing a wall (GAME_DESIGN.md §3.17.6): the points so far, their length and price.
  const draft = $derived(
    ui.placing === "wall" && ui.wallPoints.length >= 2
      ? wallPreview(ui.buildContext, ui.wallPoints, null)
      : null,
  );
</script>

{#if items.length > 0}
  <div class="build">
    <!-- Instructions get their own line (the row is full of buildings since 2B.2). -->
    {#if placing || airlift}
      <span class="label">
        {#if placing?.type === "wall"}
          {#if ui.wallPoints.length === 0}
            Click your land to start a wall (point A)
          {:else if !draft}
            Click point B
          {:else}
            {draft.newTiles} tiles · {formatTroops(draft.price)} — click more points, or right-click to
            build
          {/if}
          <span class="muted">· Esc to cancel</span>
        {:else if airlift?.mode === "assault"}
          Click an enemy's land within range to land {formatTroops(airlift.troops)} troops by air
          <span class="muted">· Esc or right-click to cancel</span>
        {:else if airlift}
          Click an ally's or teammate's land within range to airlift {formatTroops(airlift.troops)}
          troops
          <span class="muted">· Esc or right-click to cancel</span>
        {:else if placing}
          Click your land to place the {placing.name}
          <span class="muted">· Esc or right-click to cancel</span>
        {/if}
      </span>
    {/if}
    <div class="items" role="toolbar" aria-label="Buildings">
      {#each items as item (item.type)}
        <button
          type="button"
          class="item"
          class:active={ui.placing === item.type}
          class:short={!item.affordable}
          tabindex={-1}
          disabled={!item.affordable && ui.placing !== item.type}
          title="{item.name} — {item.role}{item.affordable ? '' : ' (not enough gold)'}"
          onclick={() => onPick(item.type)}
        >
          <BuildingIcon type={item.type} size={26} />
          <span class="text">
            <span class="name">{item.name}</span>
            <span class="price">{formatTroops(item.price)}{item.unit}</span>
          </span>
        </button>
      {/each}
      {#if items.some((i) => i.type === "sam")}
        <button
          type="button"
          class="view"
          class:on={ui.airDefense}
          tabindex={-1}
          aria-pressed={ui.airDefense}
          aria-label="Air defence view"
          title="Air defence view: every SAM's range on the map (V)"
          onclick={() => (ui.airDefense = !ui.airDefense)}
        >
          <span class="view-icon">◎</span>
          <span class="key">V</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .build {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-2) var(--space-3);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--surface-hairline);
    font-size: var(--text-sm);
  }

  .label {
    flex: 1 0 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }

  .muted {
    color: var(--text-muted);
  }

  .items {
    display: flex;
    gap: 6px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 var(--space-2) 0 6px;
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-control);
    background: rgb(255 255 255 / 0.05);
    color: #f6f1e4;
    font: inherit;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .item:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.11);
  }

  .item.active {
    border-color: var(--player-color);
    background: color-mix(in srgb, var(--player-color) 22%, transparent);
  }

  .item:disabled {
    cursor: default;
    color: var(--text-muted);
  }

  .item:disabled :global(img) {
    filter: grayscale(0.8);
    opacity: 0.55;
  }

  .text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.15;
  }

  .name {
    font-weight: 600;
    font-size: 12px;
  }

  .price {
    font-size: 11px;
    font-weight: 650;
    color: var(--color-gold);
    font-variant-numeric: tabular-nums;
  }

  .short .price {
    color: var(--color-danger);
  }

  .view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 36px;
    padding: 0;
    border: 1px dashed var(--surface-hairline);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
  }

  .view:hover {
    background: rgb(255 255 255 / 0.08);
  }

  .view.on {
    border-style: solid;
    border-color: rgb(255 110 90 / 0.8);
    background: rgb(255 110 90 / 0.14);
    color: #f6f1e4;
  }

  .view-icon {
    font-size: 17px;
    line-height: 1;
  }

  .key {
    font-size: 9px;
    line-height: 1;
    color: var(--text-muted);
  }
</style>
