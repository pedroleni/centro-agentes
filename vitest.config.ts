import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['compartido/test/**/*.test.ts', 'agente/test/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
