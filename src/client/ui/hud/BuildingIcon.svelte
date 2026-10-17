<script lang="ts">
  /**
   * A building's or wall's picture: the painted sprite for its level (sprites.ts, the user's
   * icon pack — D-028), the same art as on the map, with its type badge (D-033): a disc in
   * the type's colour with its symbol, so Housing and Factories can't be mixed up.
   */
  import type { Placeable } from "../../app/buildings.ts";
  import { TYPE_COLORS, TYPE_GLYPHS } from "../../icons.ts";
  import { spriteUrl } from "../../sprites.ts";

  interface Props {
    type: Placeable;
    level?: number;
    size?: number;
    badge?: boolean;
  }

  let { type, level = 1, size = 24, badge = true }: Props = $props();
  const disc = $derived(Math.max(11, Math.round(size * 0.46)));
</script>

<span class="icon" style:width="{size}px" style:height="{size}px">
  <img src={spriteUrl(type, level)} width={size} height={size} alt="" draggable="false" />
  {#if badge}
    <svg
      class="badge"
      viewBox="0 0 24 24"
      width={disc}
      height={disc}
      style:background={TYPE_COLORS[type]}
      aria-hidden="true"
    >
      <path d={TYPE_GLYPHS[type]} transform="translate(4.2 4.2) scale(0.65)" fill="#fff" />
    </svg>
  {/if}
</span>

<style>
  .icon {
    position: relative;
    display: block;
    flex: none;
  }

  img {
    display: block;
    object-fit: contain;
  }

  .badge {
    position: absolute;
    top: -3px;
    left: -3px;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px rgb(14 18 26 / 0.9);
  }
</style>
