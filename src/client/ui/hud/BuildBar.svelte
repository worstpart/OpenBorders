<script lang="ts">
  /**
   * The build bar (GAME_DESIGN.md §3.17.13), the bottom row of the command bar: one tile per
   * building with its price. Clicking one picks it up — it follows the mouse until a click
   * on your land places it; right-click or Esc puts it back.
   */
  import { buildBarItems } from "../../app/buildings.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import type { BuildingType } from "../../../sim/rules.ts";
  import { formatTroops } from "../../format.ts";
  import BuildingIcon from "./BuildingIcon.svelte";

  interface Props {
    onPick: (type: BuildingType) => void;
  }

  let { onPick }: Props = $props();

  const items = $derived(ui.screen === "game" ? buildBarItems(ui.buildContext) : []);
  const placing = $derived(items.find((i) => i.type === ui.placing) ?? null);
</script>

{#if items.length > 0}
  <div class="build">
    <span class="label">
      {#if placing}
        Click your land to place the {placing.name}
        <span class="muted">· Esc or right-click to cancel</span>
      {:else}
        Build
      {/if}
    </span>
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
          <BuildingIcon type={item.type} size={22} />
          <span class="text">
            <span class="name">{item.name}</span>
            <span class="price">{formatTroops(item.price)}</span>
          </span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .build {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--surface-hairline);
    font-size: var(--text-sm);
  }

  .label {
    flex: 1;
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
    gap: var(--space-2);
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 36px;
    padding: 0 var(--space-3) 0 var(--space-2);
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
</style>
