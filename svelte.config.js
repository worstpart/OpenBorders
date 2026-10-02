/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  compilerOptions: {
    // All our components use Svelte 5 runes ($state, $props, ...); never the legacy syntax.
    runes: true,
  },
};
