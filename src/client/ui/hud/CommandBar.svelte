<script lang="ts">
  import { DEFAULT_RULES } from "../../../sim/rules.ts";
  import { ATTACK_PRESETS } from "../../app/attackPercent.ts";
  import { missileLauncher } from "../../app/flights.ts";
  import { GROWTH_TEXT, troopBarModel } from "../../app/troopBar.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatTroops } from "../../format.ts";
  import type { Placeable } from "../../app/buildings.ts";
  import BuildBar from "./BuildBar.svelte";

  import type { MissileKind } from "../../../sim/world.ts";

  interface Props {
    onPickBuilding: (type: Placeable) => void;
    onAimMissile: (kind: MissileKind) => void;
  }

  let { onPickBuilding, onAimMissile }: Props = $props();

  const me = $derived(ui.me);
  const economy = DEFAULT_RULES.economy.enabled;
  // The missile launcher (D-033): one button per missile your Silos can fire.
  const launcher = $derived(
    me && ui.tick >= 0 ? missileLauncher(DEFAULT_RULES, ui.buildings, me, ui.tick) : [],
  );
  const aiming = $derived(ui.missileAuto && ui.airliftFrom !== null ? ui.liftMode : null);
  const MISSILE_ICON: Record<MissileKind, string> = { missile: "🚀", buster: "🎯", warhead: "☢" };
  const landCapacity = $derived(me ? Math.max(0, me.capacity - me.capacityBonus) : 0);
  const goldPerSecond = $derived(me ? (me.goldPerTick * 1000) / DEFAULT_RULES.tickMs : 0);
  const bar = $derived(
    me ? troopBarModel(me.homeTroops, me.fieldTroops, me.capacity, ui.attackPercent) : null,
  );
  const perSecond = $derived(me ? (me.growthPerTick * 1000) / DEFAULT_RULES.tickMs : 0);
  const pct = (share: number) => `${(share * 100).toFixed(2)}%`;

  // The attack chips sit just above this card, whose height grew with the gold and build
  // rows: publish the real height instead of a fixed guess (they hid behind it).
  let height = $state(0);
  $effect(() => {
    if (height > 0) {
      document.documentElement.style.setProperty("--command-bar-height", `${height}px`);
    }
  });
</script>

{#if me?.alive && me.spawned && bar}
  <section
    bind:clientHeight={height}
    class="bar-card"
    class:full={bar.state === "full"}
    style:--player-color={ui.colorOf(ui.localPlayerId)}
    aria-label="Troops and attack size"
  >
    <div class="numbers">
      <span class="home" title="Troops at home (defending)">{formatTroops(me.homeTroops)}</span>
      <span
        class="cap"
        title="Capacity: troops at home and in the field can't exceed this — {formatTroops(
          landCapacity,
        )} from your land, {formatTroops(me.capacityBonus)} from Housing"
      >
        / {formatTroops(me.capacity)}
      </span>
      {#if me.capacityBonus > 0}
        <span class="housing" title="Troop capacity from your Housing">
          🏠 +{formatTroops(me.capacityBonus)}
        </span>
      {/if}
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
              title="Send {preset}% (Shift+{i + 1})"
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

    {#if economy}
      <div class="economy">
        <span class="gold" title="Gold: earned from your land every second (more land, more gold)">
          <span class="coin" aria-hidden="true"></span>
          {formatTroops(me.gold)} gold
          <span class="income">+{formatTroops(goldPerSecond)}/s</span>
        </span>
        {#if launcher.length > 0}
          <div class="launcher" role="group" aria-label="Missiles">
            {#each launcher as slot (slot.kind)}
              <button
                type="button"
                class="launch"
                class:active={aiming === slot.kind}
                class:poor={!slot.affordable}
                tabindex={-1}
                disabled={slot.ready < 1 && aiming !== slot.kind}
                title={slot.ready < 1
                  ? `${slot.name}: none ready — your Silos are reloading`
                  : `Aim a ${slot.name.toLowerCase()} (${formatTroops(slot.cost)} gold each): every click on enemy land fires one from a Silo that can reach it (key ${slot.key})`}
                onclick={() => onAimMissile(slot.kind)}
              >
                <span aria-hidden="true">{MISSILE_ICON[slot.kind]}</span>
                {slot.name}
                <span class="count">{slot.ready}</span>
                <kbd>{slot.key}</kbd>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <BuildBar onPick={onPickBuilding} />
    {/if}
  </section>
{/if}

<style>
  .bar-card {
    pointer-events: auto;
    position: absolute;
    left: 50%;
    bottom: var(--space-4);
    transform: translateX(-50%);
    /* Room for six buildings, the wall and the air defence toggle on one row (D-033). */
    width: min(700px, calc(100% - 2 * var(--space-4)));
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

  .housing {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
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

  .economy {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--surface-hairline);
    font-size: var(--text-sm);
  }

  .gold {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 650;
    color: var(--color-gold);
  }

  .coin {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-gold);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, #000 22%, var(--color-gold));
  }

  .income {
    font-weight: 600;
    color: var(--text-secondary);
  }

  .launcher {
    display: flex;
    gap: 6px;
  }

  .launch {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 var(--space-2);
    border: 1px solid rgb(255 120 90 / 0.5);
    border-radius: var(--radius-control);
    background: rgb(255 120 90 / 0.12);
    color: var(--text-primary);
    font: inherit;
    font-weight: 650;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .launch:hover:not(:disabled) {
    background: rgb(255 120 90 / 0.24);
  }

  .launch.active {
    border-color: #fff;
    background: rgb(255 120 90 / 0.35);
  }

  .launch:disabled {
    border-color: var(--surface-hairline);
    background: none;
    color: var(--text-muted);
    cursor: default;
  }

  .launch.poor .count {
    color: var(--color-danger);
  }

  .count {
    min-width: 14px;
    padding: 1px 5px;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.12);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  kbd {
    padding: 0 5px;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.1);
    font: inherit;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .custom {
    margin-right: var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
</style>
