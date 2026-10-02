<script lang="ts">
  interface Props {
    /** Set when the map can't be drawn (e.g. no WebGL2); shown instead of the start screen. */
    fatalError?: string | null;
  }

  let { fatalError = null }: Props = $props();
</script>

<main class="screen">
  {#if fatalError}
    <section class="card" role="alert">
      <h1>Can't start the game</h1>
      <p>{fatalError}</p>
    </section>
  {:else}
    <section class="card">
      <h1>Borderline</h1>
      <p class="subtitle">Working title · prototype in development</p>
      <p class="placeholder">
        <strong>Placeholder start screen.</strong> The map and the Play button arrive with the playable
        prototype (Phase 1, milestones 1.1–1.2).
      </p>
    </section>
  {/if}
</main>

<style>
  .screen {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--space-4);
  }

  .card {
    pointer-events: auto;
    max-width: 420px;
    padding: var(--space-6) var(--space-8);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: var(--text-display);
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  [role="alert"] h1 {
    font-size: var(--text-lg);
    color: var(--color-danger);
  }

  p {
    margin: var(--space-3) 0 0;
    line-height: 1.5;
  }

  .subtitle {
    margin-top: var(--space-1);
    color: var(--text-secondary);
  }

  .placeholder {
    margin-top: var(--space-6);
    padding: var(--space-3);
    border: 1px dashed var(--surface-hairline);
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
</style>
