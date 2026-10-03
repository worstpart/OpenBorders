<script lang="ts">
  /** A building's drawing (icons.ts — the same art as on the map), as inline SVG. */
  import type { Placeable } from "../../app/buildings.ts";
  import { iconPath } from "../../icons.ts";

  interface Props {
    type: Placeable;
    level?: number;
    size?: number;
  }

  let { type, level = 1, size = 24 }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
  <path d={iconPath(type, level)} fill="currentColor" fill-rule="evenodd" />
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
