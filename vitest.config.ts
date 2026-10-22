import { defineConfig } from 'vitest/config';

// Each test starts its own PGlite database; with every file running at once, setup alone can take seconds.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
