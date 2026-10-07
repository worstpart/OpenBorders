<script lang="ts">
  /**
   * A building's picture, the same art as on the map: the painted sprite for its level
   * (sprites.ts, D-028), or — for walls, which have no painted art yet — the line drawing
   * (icons.ts) as inline SVG.
   */
  import type { Placeable } from "../../app/buildings.ts";
  import { iconPath } from "../../icons.ts";
  import { spriteUrl } from "../../sprites.ts";

  interface Props {
    type: Placeable;
    level?: number;
    size?: number;
  }

  let { type, level = 1, size = 24 }: Props = $props();
</script>

{#if type === "wall"}
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d={iconPath(type, level)} fill="currentColor" fill-rule="evenodd" />
  </svg>
{:else}
  <img src={spriteUrl(type, level)} width={size} height={size} alt="" draggable="false" />
{/if}

<style>
  svg,
  img {
    display: block;
    flex: none;
  }

  img {
    object-fit: contain;
  }
</style>
