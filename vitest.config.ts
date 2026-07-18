import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Coverage is scoped to the simulation/data layer — the DOM layer
      // (renderer, ui, components, input, audio, main) is exercised by the
      // Playwright-driven live verifications instead of unit tests.
      include: [
        'src/game.ts', 'src/entities.ts', 'src/balance.ts', 'src/storage.ts',
        'src/dataLoader.ts', 'src/errorReporting.ts', 'src/systems/**',
      ],
      // Ratchet: raise these as coverage grows; CI fails if a change drops below.
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 73,
      },
    },
  },
});
