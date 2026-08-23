# Contributing to Task Vault

Thanks for helping improve Task Vault. This is an Obsidian plugin (TypeScript, zero runtime
dependencies) developed alongside a Python syncer. Please keep changes small and focused.

## Local development

Requires Node 18+ (CI uses Node 22).

```bash
npm install        # dev tooling only — esbuild, vitest, typescript, @types/node
npm run dev        # esbuild watch build → main.js
npm run build      # one-shot production bundle
npm test           # vitest (unit)
npm run typecheck  # tsc --noEmit (strict)
```

To try the plugin in a real vault: `npm run install:vault` (see `scripts/install-vault.mjs`).

Before opening a PR, all three must be green: `npm test`, `npm run typecheck`, `npm run build`.

## Pull request conventions

- Branch off `main`; keep one logical change per PR.
- **Conventional Commits** for titles and commits: `feat:`, `fix:`, `refactor:`, `test:`,
  `chore:`, `docs:`, `perf:`, `ci:`. Reference the spec requirement when relevant
  (e.g. `feat(cmd): … (FR-032)`).
- Add or update tests for behavior changes; prefer pure, obsidian-free logic that unit-tests
  without the Obsidian runtime (the `obsidian` module is externalized at build time and
  stubbed for tests under `tests/__stubs__/`).
- Describe what changed and why; list the manual/automated checks you ran.

## The shared contract (`AGENTS.md`)

`AGENTS.md` is the **single shared runtime contract** between the TypeScript plugin and the
Python syncer — the `.taskvault/` directory layout, `config.json`/`ledger.json` schemas, and
the idempotency rules. Field-level schema authority lives in `docs/spec.md`. **Any change to
`.taskvault/` shapes, ledger semantics, or hook placeholders must update `AGENTS.md` in the
same PR and be reviewed by the other side.** Do not drift these formats unilaterally.

## Code of conduct

Be respectful and constructive. Assume good faith, keep discussion technical, and give
actionable feedback. Harassment or discrimination of any kind is not welcome here.
