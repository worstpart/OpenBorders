<script lang="ts">
  /**
   * The build bar (GAME_DESIGN.md §3.17.13), the bottom row of the command bar: one tile per
   * building with its price. Clicking one picks it up — it follows the mouse until a click
   * on your land places it; right-click or Esc puts it back. Keys 1–7 pick them up in this
   * order (D-033); names stay on one line (two-line names spilled out of the box).
   */
  import { buildBarItems, wallPreview, type Placeable } from "../../app/buildings.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatTroops } from "../../format.ts";
  import BuildingIcon from "./BuildingIcon.svelte";
  import { DEFAULT_RULES } from "../../../sim/rules.ts";
  import { airliftTroops } from "../../../sim/systems/flights.ts";
  import { strikeMissileText } from "../../app/flights.ts";

  interface Props {
    onPick: (type: Placeable) => void;
  }

  let { onPick }: Props = $props();

  /** Shorter names where the full one doesn't fit the tile. */
  const SHORT: Partial<Record<Placeable, string>> = { sam: "SAM", silo: "Silo" };

  const items = $derived(ui.screen === "game" ? buildBarItems(ui.buildContext) : []);
  const placing = $derived(items.find((i) => i.type === ui.placing) ?? null);
  // Choosing where an Airport airlifts to, or lands an airborne assault (GAME_DESIGN.md §3.17.7).
  const airlift = $derived.by(() => {
    const airport = ui.buildings.find((b) => b.id === ui.airliftFrom);
    if (!airport || !ui.me) return null;
    return {
      mode: ui.liftMode,
      level: airport.level,
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
    {#if placing || airlift || ui.selectedWarship !== null}
      <span class="label">
        {#if ui.selectedWarship !== null}
          ⚓ Warship selected — click the sea to send it there; it patrols and fights within {DEFAULT_RULES
            .warships.orderRange} km of that spot
          <span class="muted">· Esc or right-click to cancel</span>
        {:else if placing?.type === "wall"}
          {#if ui.wallPoints.length === 0}
            Click your land to start a wall (point A)
          {:else if !draft}
            Click point B
          {:else}
            {draft.newTiles} tiles · {formatTroops(draft.price)} — click more points, or right-click to
            build
          {/if}
          <span class="muted">· Esc to cancel</span>
        {:else if airlift?.mode === "missile"}
          Click enemy land within range for a strike missile — {strikeMissileText(
            DEFAULT_RULES,
            airlift.level,
          )}
          <span class="muted">· Esc or right-click to cancel</span>
        {:else if airlift?.mode === "buster"}
          Click an enemy building within range for a bunker buster
          <span class="muted">· Esc or right-click to cancel</span>
        {:else if airlift?.mode === "warhead"}
          Click enemy land anywhere for the strategic warhead — {DEFAULT_RULES.flights
            .warheadRadius} km scorched
          <span class="muted">· Esc or right-click to cancel</span>
        {:else if airlift?.mode === "strike"}
          Click an enemy building, or their land (walls), within range for an air strike
          <span class="muted">· Esc or right-click to cancel</span>
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
      {#each items as item, index (item.type)}
        <button
          type="button"
          class="item"
          class:active={ui.placing === item.type}
          class:short={!item.affordable}
          tabindex={-1}
          disabled={!item.affordable && ui.placing !== item.type}
          title="{item.name} — {item.role}{item.affordable
            ? ''
            : ' (not enough gold)'} (key {index + 1})"
          onclick={() => onPick(item.type)}
        >
          <BuildingIcon type={item.type} size={24} />
          <span class="text">
            <span class="name">{SHORT[item.type] ?? item.name}</span>
            <span class="price">{formatTroops(item.price)}{item.unit}</span>
          </span>
          <kbd class="hotkey">{index + 1}</kbd>
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

  /* One row on a normal screen; on a narrow one the tiles wrap instead of spilling out. */
  .items {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px;
  }

  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 11px 0 6px;
    white-space: nowrap;
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
    justify-content: center;
    align-items: flex-start;
    gap: 1px;
    line-height: 1.1;
  }

  .hotkey {
    position: absolute;
    top: 3px;
    right: 3px;
    font: inherit;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    color: var(--text-muted);
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
    height: 38px;
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
