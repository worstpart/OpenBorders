<script lang="ts">
  /**
   * A building's or wall's picture: the painted sprite for its level (sprites.ts, the user's
   * icon pack — D-028), the same art as on the map.
   */
  import type { Placeable } from "../../app/buildings.ts";
  import { spriteUrl } from "../../sprites.ts";

  interface Props {
    type: Placeable;
    level?: number;
    size?: number;
  }

  let { type, level = 1, size = 24 }: Props = $props();
</script>

<img src={spriteUrl(type, level)} width={size} height={size} alt="" draggable="false" />

<style>
  img {
    display: block;
    flex: none;
    object-fit: contain;
  }
</style>
