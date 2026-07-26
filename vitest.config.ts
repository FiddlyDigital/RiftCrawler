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
        // Feature modules split out of game.ts (each a class composed onto Game).
        'src/fidchell.ts', 'src/causewayDuel.ts', 'src/waystation.ts',
        'src/bossEncounters.ts', 'src/vendorOffers.ts', 'src/spawning.ts',
        'src/runSetup.ts', 'src/saveGame.ts', 'src/pact.ts',
        'src/npcEncounters.ts', 'src/smithQuest.ts', 'src/gameMath.ts',
        'src/views/**',
      ],
      // Ratchet: raise these as coverage grows; CI fails if a change drops below.
      thresholds: {
        statements: 83,
        branches: 74,
        functions: 83,
        lines: 86,
      },
    },
  },
});
