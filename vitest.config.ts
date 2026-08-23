import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

<<<<<<< HEAD
// esbuild externalizes `obsidian` for the real build; vitest has no such externalization,
// so point the specifier at a behavior-free stub. Without this, any suite importing a module
// with runtime `obsidian` value-imports fails to load (Scorecard hygiene, FR-033).
export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./tests/__stubs__/obsidian.ts', import.meta.url)),
=======
// `obsidian` is externalized at build time and has no runtime package here, so any test that
// imports a view module (for its pure exports) fails to resolve it. Alias it to a bare stub.
export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)),
>>>>>>> abf340a (feat(view): H7 项目面板 — 全库项目统计+项目详情 (FR-035))
    },
  },
});
