<script lang="ts">
  /**
   * A building's card (GAME_DESIGN.md §3.17.13): opened by clicking its icon. Name, level
   * pips, what it gives; for your own: construction progress (with Cancel) and the next
   * level's price and gains (Upgrade); your Airport's Airlift button (GAME_DESIGN.md
   * §3.17.7) with its capacity and cooldown. Small, next to the building, closes with Esc or
   * a click elsewhere.
   */
  import { buildingCard, wallCard } from "../../app/buildings.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { DEFAULT_RULES } from "../../../sim/rules.ts";
  import { formatTroops } from "../../format.ts";
  import BuildingIcon from "./BuildingIcon.svelte";

  interface Props {
    /** `wall`: the card is a wall's (GAME_DESIGN.md §3.17.6). */
    onUpgrade: (id: number, wall: boolean) => void;
    onCancel: (id: number, wall: boolean) => void;
    /** Start choosing where this Airport airlifts to. */
    onAirlift: (id: number) => void;
    onClose: () => void;
  }

  let { onUpgrade, onCancel, onAirlift, onClose }: Props = $props();

  const WIDTH = 270;
  const REFUND = Math.round(DEFAULT_RULES.buildings.cancelRefund * 100);
  const TYPE_LABEL = {
    housing: "Housing",
    factory: "Factory",
    port: "Port",
    airport: "Airport",
    wall: "Wall",
  } as const;
  let cardElement = $state<HTMLElement | null>(null);
  let height = $state(0);
  let viewportWidth = $state(1280);
  let viewportHeight = $state(800);

  const menu = $derived(ui.menu?.kind === "building" || ui.menu?.kind === "wall" ? ui.menu : null);
  const isWall = $derived(menu?.kind === "wall");
  const card = $derived.by(() => {
    if (!menu) return null;
    if (menu.kind === "wall") {
      const wall = ui.walls.find((w) => w.id === menu.id);
      return wall ? wallCard(ui.buildContext, wall) : null;
    }
    const building = ui.buildings.find((b) => b.id === menu.id);
    return building ? buildingCard(ui.buildContext, building) : null;
  });
  const left = $derived(menu ? Math.max(8, Math.min(menu.x + 16, viewportWidth - WIDTH - 8)) : 0);
  const top = $derived(menu ? Math.max(8, Math.min(menu.y - 24, viewportHeight - height - 8)) : 0);

  $effect(() => {
    if (card && cardElement) cardElement.querySelector<HTMLButtonElement>("button")?.focus();
  });

  function formatSeconds(seconds: number): string {
    const s = Math.ceil(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

{#if menu && card}
  <div
    class="backdrop"
    role="presentation"
    onpointerdown={onClose}
    oncontextmenu={(e) => e.preventDefault()}
  ></div>
  <div
    class="card"
    role="dialog"
    aria-label={card.name}
    tabindex="-1"
    bind:this={cardElement}
    bind:clientHeight={height}
    style:left="{left}px"
    style:top="{top}px"
    style:width="{WIDTH}px"
    style:--owner-color={ui.colorOf(card.owner)}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <div class="head">
      <span class="type">{TYPE_LABEL[card.type]}</span>
      <span class="pips" aria-label="Level {card.level} of 3">
        {#each [1, 2, 3] as k (k)}<span class="pip" class:on={k <= card.level}></span>{/each}
      </span>
    </div>
    <div class="title">
      <span class="art"
        ><BuildingIcon type={card.type} level={Math.max(1, card.level)} size={44} /></span
      >
      <span class="name">{card.name}</span>
      {#if card.level > 0}<span class="muted">Level {card.level}</span>{/if}
    </div>
    {#if !card.mine}
      <div class="owner"><span class="dot"></span>{ui.playerName(card.owner)}</div>
    {/if}
    {#if card.effects.length > 0}
      <ul class="effects">
        {#each card.effects as line (line)}<li>{line}</li>{/each}
      </ul>
    {/if}

    {#if card.work}
      <div class="work">
        <div class="work-line">
          <span
            >{card.level === 0
              ? "Under construction"
              : `Upgrading to level ${card.work.level}`}</span
          >
          <span class="muted">{formatSeconds(card.work.secondsLeft)}</span>
        </div>
        <div class="bar"><div class="fill" style:width="{card.work.progress * 100}%"></div></div>
        {#if card.mine}
          <button type="button" class="quiet" onclick={() => onCancel(card.id, isWall)}>
            Cancel <span class="muted">refunds {REFUND}%</span>
          </button>
        {/if}
      </div>
    {/if}

    {#if card.airlift}
      <div class="divider"></div>
      <button
        type="button"
        class="upgrade"
        disabled={card.airlift.secondsLeft > 0}
        onclick={() => onAirlift(card.id)}
      >
        <span>✈ Airlift troops</span>
        <span class="muted"
          >{card.airlift.secondsLeft > 0
            ? `ready in ${Math.ceil(card.airlift.secondsLeft)} s`
            : `up to ${formatTroops(card.airlift.capacity)}`}</span
        >
      </button>
      <div class="muted hint">
        To an ally's or teammate's land in range; what they can't hold flies back
      </div>
    {/if}

    {#if card.upgrade}
      <div class="divider"></div>
      <button
        type="button"
        class="upgrade"
        disabled={!card.upgrade.affordable}
        onclick={() => onUpgrade(card.id, isWall)}
      >
        <span>Upgrade to {card.upgrade.name}</span>
        <span class="price" class:short={!card.upgrade.affordable}
          >{formatTroops(card.upgrade.price)}</span
        >
      </button>
      <ul class="gains">
        {#each card.upgrade.lines as line (line)}<li>{line}</li>{/each}
      </ul>
    {:else if card.mine && !card.work && card.level >= 3}
      <div class="divider"></div>
      <div class="muted top">Top level</div>
    {:else if card.laterLevel}
      <div class="divider"></div>
      <div class="muted top">{card.laterLevel}</div>
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    pointer-events: auto;
  }

  .card {
    position: absolute;
    pointer-events: auto;
    padding: var(--space-3);
    background: var(--surface-glass-strong);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-top: 2px solid var(--owner-color);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    font-size: var(--text-sm);
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--text-muted);
    font-size: var(--text-xs, 11px);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .type {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .pips {
    display: flex;
    gap: 4px;
  }

  .pip {
    width: 8px;
    height: 8px;
    border: 1px solid rgb(255 255 255 / 0.5);
    border-radius: 50%;
  }

  .pip.on {
    border-color: var(--color-gold);
    background: var(--color-gold);
  }

  .title {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin-top: 2px;
  }

  .hint {
    margin-top: 4px;
    font-size: 11px;
  }

  .art {
    align-self: center;
    margin: -2px 2px -4px -2px;
  }

  .name {
    font-size: var(--text-md);
    font-weight: 650;
  }

  .owner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
    color: var(--text-secondary);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--owner-color);
  }

  ul {
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
    line-height: 1.5;
  }

  .effects li {
    color: var(--text-primary);
  }

  .gains li {
    color: var(--text-secondary);
  }

  .gains li::before {
    content: "+ ";
    color: var(--color-success);
  }

  .work {
    margin-top: var(--space-2);
  }

  .work-line {
    display: flex;
    justify-content: space-between;
    color: var(--text-secondary);
  }

  .bar {
    height: 4px;
    margin-top: var(--space-1);
    border-radius: 2px;
    background: rgb(255 255 255 / 0.1);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--color-gold);
    transition: width 100ms linear;
  }

  .muted {
    color: var(--text-muted);
  }

  .top {
    padding-top: var(--space-1);
  }

  .divider {
    height: 1px;
    margin: var(--space-2) 0;
    background: var(--surface-hairline);
  }

  button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 30px;
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-control);
    background: rgb(255 255 255 / 0.06);
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  button:hover:not(:disabled),
  button:focus-visible {
    background: rgb(255 255 255 / 0.12);
    outline: none;
  }

  button:disabled {
    color: var(--text-muted);
    cursor: default;
  }

  button.upgrade {
    font-weight: 600;
  }

  button.quiet {
    margin-top: var(--space-2);
    background: none;
  }

  .price {
    margin-left: auto;
    color: var(--color-gold);
    font-variant-numeric: tabular-nums;
  }

  .price.short {
    color: var(--color-danger);
  }
</style>
