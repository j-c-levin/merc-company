// Deliberately no svelte plugin: the suite is pure sim code run in node,
// and the plugin drags in dependency optimization, which crashes on
// rolldown's virtual runtime module (tsconfig resolution bug in vite 8).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
