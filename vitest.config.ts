import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// esbuild externalizes `obsidian` for the real build; vitest has no such externalization,
// so point the specifier at a behavior-free stub. Without this, any suite importing a module
// with runtime `obsidian` value-imports fails to load (Scorecard hygiene, FR-033).
export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./tests/__stubs__/obsidian.ts', import.meta.url)),
    },
  },
});
