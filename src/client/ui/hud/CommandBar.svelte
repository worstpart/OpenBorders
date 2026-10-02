<script lang="ts">
  import { DEFAULT_RULES } from "../../../sim/rules.ts";
  import { ATTACK_PRESETS } from "../../app/attackPercent.ts";
  import { GROWTH_TEXT, troopBarModel } from "../../app/troopBar.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatTroops } from "../../format.ts";

  const me = $derived(ui.me);
  const bar = $derived(
    me ? troopBarModel(me.homeTroops, me.fieldTroops, me.capacity, ui.attackPercent) : null,
  );
  const perSecond = $derived(me ? (me.growthPerTick * 1000) / DEFAULT_RULES.tickMs : 0);
  const pct = (share: number) => `${(share * 100).toFixed(2)}%`;
</script>

{#if me?.alive && me.spawned && bar}
  <section
    class="bar-card"
    class:full={bar.state === "full"}
    style:--player-color={ui.colorOf(ui.localPlayerId)}
    aria-label="Troops and attack size"
  >
    <div class="numbers">
      <span class="home" title="Troops at home (defending)">{formatTroops(me.homeTroops)}</span>
      <span class="cap" title="Capacity: troops at home and in the field can't exceed this">
        / {formatTroops(me.capacity)}
      </span>
      {#if me.fieldTroops >= 1}
        <span class="field" title="Troops away in attacks (count toward capacity)">
          {formatTroops(me.fieldTroops)} in the field
        </span>
      {/if}
      <span class="growth" title="Troops gained per second">+{formatTroops(perSecond)}/s</span>
    </div>

    <div
      class="track"
      role="meter"
      aria-label="Home troops"
      aria-valuemin={0}
      aria-valuemax={Math.round(me.capacity)}
      aria-valuenow={Math.round(me.homeTroops)}
    >
      <div class="zone" title="Troops grow fastest in this zone (around half capacity)"></div>
      <div class="fill" style:width={pct(bar.after)}></div>
      <div class="send" style:left={pct(bar.after)} style:width={pct(bar.send)}></div>
      <div class="field-fill" style:left={pct(bar.home)} style:width={pct(bar.field)}></div>
      <div class="tick" aria-hidden="true"><span>½</span></div>
    </div>

    <div class="controls">
      <span class="state {bar.state}">
        <span class="state-dot" aria-hidden="true"></span>
        {GROWTH_TEXT[bar.state]}
      </span>
      <div class="send-control">
        <span class="send-label">Send</span>
        <div class="presets" role="radiogroup" aria-label="Share of home troops a click sends">
          {#each ATTACK_PRESETS as preset, i (preset)}
            <button
              type="button"
              role="radio"
              aria-checked={ui.attackPercent === preset}
              class:active={ui.attackPercent === preset}
              title="Send {preset}% (key {i + 1})"
              tabindex={-1}
              onclick={() => (ui.attackPercent = preset)}>{preset}</button
            >
          {/each}
        </div>
        <span
          class="send-amount"
          title="A click sends {ui.attackPercent}% of your home troops (Q/E or Shift+wheel ±5)"
        >
          {#if !(ATTACK_PRESETS as readonly number[]).includes(ui.attackPercent)}
            <span class="custom">{ui.attackPercent}%</span>
          {/if}
          {formatTroops(bar.sendTroops)}
        </span>
      </div>
    </div>
  </section>
{/if}

<style>
  .bar-card {
    pointer-events: auto;
    position: absolute;
    left: 50%;
    bottom: var(--space-4);
    transform: translateX(-50%);
    width: min(580px, calc(100% - 2 * var(--space-4)));
    padding: var(--space-3) var(--space-4);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    transition: border-color var(--duration-normal) var(--ease-out);
  }

  .bar-card.full {
    border-color: color-mix(in srgb, var(--color-warning) 70%, transparent);
    animation: nudge 1.6s ease-in-out infinite;
  }

  @keyframes nudge {
    50% {
      box-shadow:
        var(--shadow-card),
        0 0 0 3px color-mix(in srgb, var(--color-warning) 30%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar-card.full {
      animation: none;
    }
  }

  .numbers {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .home {
    font-size: var(--text-lg);
    font-weight: 650;
  }

  .cap {
    color: var(--text-secondary);
  }

  .field {
    margin-left: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .growth {
    margin-left: auto;
    font-weight: 600;
    color: var(--color-success);
  }

  .track {
    position: relative;
    height: 16px;
    border-radius: 5px;
    background: rgb(255 255 255 / 0.07);
    overflow: hidden;
  }

  /* The sweet spot: growth is within ~90% of its peak between 35% and 65%. */
  .zone {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 35%;
    width: 30%;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--color-success) 26%, transparent) 50%,
      transparent
    );
  }

  .fill,
  .send,
  .field-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    transition:
      width var(--duration-normal) var(--ease-out),
      left var(--duration-normal) var(--ease-out);
  }

  .fill {
    left: 0;
    background: var(--player-color);
  }

  /* What a click would send: still yours, hatched. */
  .send {
    background: repeating-linear-gradient(
      135deg,
      var(--player-color) 0 4px,
      color-mix(in srgb, var(--player-color) 35%, transparent) 4px 8px
    );
  }

  .field-fill {
    background: repeating-linear-gradient(
      90deg,
      rgb(255 255 255 / 0.22) 0 2px,
      transparent 2px 5px
    );
  }

  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    margin-left: -1px;
    background: #fff;
    box-shadow: 0 0 4px rgb(0 0 0 / 0.6);
  }

  .tick span {
    position: absolute;
    left: 4px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    color: #fff;
    text-shadow: 0 0 3px rgb(0 0 0 / 0.9);
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .state-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }

  .state.peak {
    color: var(--color-success);
  }

  .state.full {
    color: var(--color-warning);
    font-weight: 600;
  }

  .send-control {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .send-label {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .presets {
    display: flex;
    padding: 2px;
    border-radius: var(--radius-control);
    background: rgb(255 255 255 / 0.06);
  }

  .presets button {
    min-width: 38px;
    height: 26px;
    padding: 0 var(--space-2);
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .presets button:hover {
    background: rgb(255 255 255 / 0.1);
    color: var(--text-primary);
  }

  .presets button.active {
    background: var(--player-color);
    color: #fff;
  }

  .send-amount {
    min-width: 56px;
    text-align: right;
    font-weight: 650;
  }

  .custom {
    margin-right: var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
</style>
