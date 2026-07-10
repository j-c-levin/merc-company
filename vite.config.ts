/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // Dep optimization crashes in vite 8.1: rolldown's tsconfig discovery runs
  // against its own virtual runtime module ("Tsconfig not found" resolving
  // node:module — rolldown#8097). All deps here are ESM, so skip prebundling
  // in BOTH environments (the svelte plugin turns it on for ssr too, which is
  // the one that actually crashes): noDiscovery stops scanning, excluding
  // svelte stops the plugin re-adding its entries, and tsconfig:false guards
  // anything that still gets bundled.
  optimizeDeps: { noDiscovery: true, exclude: ['svelte'], rolldownOptions: { tsconfig: false } },
  ssr: { optimizeDeps: { noDiscovery: true, exclude: ['svelte'], rolldownOptions: { tsconfig: false } } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
