# Pre-commit hook

Driven by [husky](https://typicode.github.io/husky/). Runs every quality gate in parallel before any commit lands locally.

| Source | [`.husky/pre-commit`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/.husky/pre-commit) |
|---|---|

## Phase 1 — Prettier autoformat

Runs first and auto-fixes whitespace / quote style / trailing commas. If anything changes, the gate cache key is recomputed *after* this step so cosmetic fixes don't invalidate the cache.

## Phase 2 — 14 gates in parallel

The hook spawns each gate as a background process and `wait`s for them all. Cache key per gate is `git write-tree` (the SHA of the staged tree); when the same SHA passes a gate, the next commit on the same content set skips it.

| # | Gate | Hook label | npm script |
|---|---|---|---|
| 1 | TypeScript | `tsc` | `type-check` |
| 2 | ESLint | `eslint` | `lint` (eslint + architecture + canaries + format:check) |
| 3 | Biome | `biome` | `biome lint src --max-diagnostics=50` |
| 4 | npm audit | `audit` | `npm audit --omit=dev` |
| 5 | Phase isolation | `lint:phases:strict` | `eslint src/Tests/Unit/Pipeline/CrossValidation/Phases --max-warnings 0` |
| 6 | Architecture | `architecture` | `lint:architecture src/Scrapers/Pipeline` |
| 7 | Build | `build` | `lint + tsup` |
| 8 | Canaries | `canaries` | `lint:canaries` |
| 9 | Dead code | `dead-code` | `lint:dead-code` |
| 10 | Guideline coverage | `guideline-coverage` | `lint:guideline-coverage` (asserts `eslint.config.mjs` enforces CLEAN_CODE.md caps for every Pipeline cluster) |
| 11 | Docs strict | `docs-strict` | `lint:docs-strict` (only fires when `docs/**`, root `*.md`, or `mkdocs.yml` is staged; runs `mkdocs build --strict` — soft-skips when Python/mkdocs not on PATH locally, CI is the hard gate) |
| 12 | Pipeline tests + coverage | `test:pipeline` | `test:pipeline` |
| 13 | Bank tests | `bank-tests` | `test:e2e-factory-tests` |
| 14 | Mock suite | `test:mock` | `test:mock` |

Total wall-clock: **3-5 minutes** on a modern laptop (everything is parallelised; the gate that takes the longest gates the whole run).

## Reading the output

```
🛑  PIPELINE QUALITY GATE
══════════════════════════════════════════════════════
📝 Phase 1: Prettier format...
🔑 cache key: ba898e775bb13de1049bfb2ee4753b6d48954b1e

⚡ Phase 2: All gates parallel...
  ❌ tsc FAILED
  ✅ eslint passed
  ❌ biome FAILED
  ✅ audit passed
  ...
❌ FAILED GATES: tsc biome
```

The summary at the end names every failing gate. Detail logs are written to `.pre-commit-output.log` at repo root (overwritten each run).

## Why these particular 14?

| Gate | Role |
|---|---|
| `tsc` + `eslint` + `biome` | Static correctness — catches type errors and rule violations before they reach review |
| `audit` | Supply-chain hygiene — fails on known CVEs in dependencies |
| `architecture` + `canaries` + `lint:phases:strict` + `dead-code` | Architectural invariants — fails when a PR reaches across a layer boundary, breaks a canary fixture, or leaves a dead export |
| `guideline-coverage` | Process invariant — fails when `eslint.config.mjs` drifts from CLEAN_CODE.md canonical caps |
| `docs-strict` | Docs build correctness — fails on broken internal links / missing pages that would break `mkdocs --strict` on CI |
| `build` | Produces the actual `lib/` ESM + CJS bundle, ensuring `tsup` can reach a green state |
| `test:pipeline` + `bank-tests` + `test:mock` | Functional regression — every PR proves all tests still pass and coverage hits the gate |

## Skipping the hook (don't)

The husky hook can be bypassed with `--no-verify`. Don't. The CI re-runs the same gates and will reject the PR anyway, wasting your iteration time.

## What happens on hook failure

The commit is **not** created — `git status` still shows your changes staged. Fix the issues, re-stage, retry. There's no half-state to clean up.
