import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['compartido/test/**/*.test.ts', 'agente/test/**/*.test.ts', 'web/test/**/*.test.{ts,tsx}'],
    testTimeout: 20_000,
  },
})
