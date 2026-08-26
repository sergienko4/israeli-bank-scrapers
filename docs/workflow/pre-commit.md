# Pre-commit hook

Driven by [husky](https://typicode.github.io/husky/). Runs 19 quality gates in parallel before any commit lands locally. Three further gates (the test suites) are currently commented out — see [Currently disabled](#currently-disabled).

| Source | [`.husky/pre-commit`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/.husky/pre-commit) |
|---|---|

## Phase 1 — Prettier autoformat

Runs first and auto-fixes whitespace / quote style / trailing commas. If anything changes, the gate cache key is recomputed *after* this step so cosmetic fixes don't invalidate the cache.

## Phase 2 — 19 gates in parallel

The hook spawns each gate as a background process and `wait`s for them all. Cache key per gate is `git write-tree` (the SHA of the staged tree); when the same SHA passes a gate, the next commit on the same content set skips it.

| # | Gate | Hook label | What it runs |
|---|---|---|---|
| 1 | TypeScript | `tsc` | `type-check` |
| 2 | ESLint (Pipeline) | `eslint:pipeline` | `npx eslint src/Scrapers/Pipeline --max-warnings=0` — Pipeline only; CI lints all of `src` |
| 3 | Biome | `biome` | `npx biome lint src --max-diagnostics=50` |
| 4 | npm audit | `audit` | `npm audit --audit-level=high --omit=dev` |
| 5 | Phase isolation | `lint:phases:strict` | `lint:phases:strict` |
| 6 | Architecture | `architecture` | `lint:architecture src` (see [architecture-linter.md](architecture-linter.md)) |
| 7 | Build | `build` | `npm run build` + [`lint:public-surface`](public-surface.md) against the freshly built `lib/` |
| 8 | Canaries | `canaries` | `lint:canaries` |
| 9 | Dead code | `dead-code` | `lint:dead-code` |
| 10 | Import cycles | `cycles` | `lint:cycles` |
| 11 | Guideline coverage | `guideline-coverage` | `lint:guideline-coverage` (asserts `eslint.config.mjs` enforces CLEAN_CODE.md caps for every Pipeline cluster) |
| 12 | Test duplication | `test-duplication` | `lint:test-duplication` |
| 13 | Bank coverage | `bank-coverage` | `lint:bank-coverage` |
| 14 | Fixture PII | `fixtures-pii` | `lint:fixtures-pii` |
| 15 | Staged PII | `pii-staged` | `lint:pii-staged` |
| 16 | Node support | `node-support` | `lint:node-support` |
| 17 | Docs strict | `docs-strict` | `lint:docs-strict` (only fires when `docs/**`, root `*.md`, or `mkdocs.yml` is staged; runs `mkdocs build --strict` — soft-skips when Python/mkdocs not on PATH locally, CI is the hard gate) |
| 18 | Docs coverage | `docs-coverage` | `.github/scripts/ci/docs-coverage.sh` (fires when any `src/Scrapers/Pipeline/**/*.ts` is staged; diffs new public exports against `origin/main`/`main` and fails if a new symbol is undocumented + un-allowlisted — soft-skips when base ref unresolvable locally, CI is the hard gate). See [Docs coverage gate](docs-coverage.md) for which export forms count. |
| 19 | Docs staleness | `docs-staleness` | `.github/scripts/ci/docs-staleness.sh` |

### Currently disabled

These three are commented out in the hook. They still run in CI, which is the
gate that counts — but a local commit does **not** execute them, so do not read
a green hook as "all tests passed".

| Gate | Hook label | Status |
|---|---|---|
| Pipeline tests + coverage | `test:pipeline` | commented out |
| Bank tests | `bank-tests` | commented out |
| Mock suite | `test:mock` | commented out |

Total wall-clock: **3-5 minutes** on a modern laptop (everything is parallelised; the gate that takes the longest gates the whole run).

## Reading the output

```
🛑  PIPELINE QUALITY GATE
══════════════════════════════════════════════════════
📝 Phase 1: Prettier format...
🔑 cache key: ba898e775bb13de1049bfb2ee4753b6d48954b1e

⚡ Phase 2: All gates parallel...
  ❌ tsc FAILED
  ✅ eslint:pipeline passed
  ❌ biome FAILED
  ✅ audit passed
  ...
❌ FAILED GATES: tsc biome
```

The summary at the end names every failing gate. Detail logs are written to `.pre-commit-output.log` at repo root (overwritten each run).

## Why these particular gates?

| Gate | Role |
|---|---|
| `tsc` + `eslint:pipeline` + `biome` | Static correctness — catches type errors and rule violations before they reach review |
| `audit` | Supply-chain hygiene — fails on known CVEs in dependencies |
| `architecture` + `canaries` + `lint:phases:strict` + `dead-code` + `cycles` | Architectural invariants — fails when a PR reaches across a layer boundary, breaks a canary fixture, leaves a dead export, or adds an import cycle |
| `guideline-coverage` | Process invariant — fails when `eslint.config.mjs` drifts from CLEAN_CODE.md canonical caps |
| `fixtures-pii` + `pii-staged` | Privacy — fails when captured fixtures or staged files carry real account data |
| `test-duplication` + `bank-coverage` + `node-support` | Suite health — duplicate test bodies, uncovered banks, unsupported Node syntax |
| `docs-strict` + `docs-staleness` | Docs build correctness and freshness |
| `docs-coverage` | Docs/code consistency — fails when a new `src/Scrapers/Pipeline/` export ships without a `docs/` mention or allowlist entry |
| `build` | Produces the actual `lib/` ESM + CJS bundle, ensuring `tsup` can reach a green state, and asserts the exported API still matches `api-surface.d.ts` |

## Skipping the hook (don't)

The husky hook can be bypassed with `--no-verify`. Don't. The CI re-runs the same gates and will reject the PR anyway, wasting your iteration time.

## What happens on hook failure

The commit is **not** created — `git status` still shows your changes staged. Fix the issues, re-stage, retry. There's no half-state to clean up.
