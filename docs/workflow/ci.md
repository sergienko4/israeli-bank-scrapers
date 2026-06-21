# CI gates

GitHub Actions runs every gate on every PR. The matrix below is the source of truth.

## Gate matrix

| Gate | npm script | Failure mode | Where to look |
|---|---|---|---|
| **Format** | `format:check` | Prettier reports unformatted files | Run `npm run format` locally |
| **Type check** | `type-check` | `tsc --noEmit` errors | `tsconfig.json` — strict mode is on, no `any`, no unused |
| **ESLint** | `lint` (also runs architecture + canaries + format:check) | Any rule violation; `--max-warnings 0` | `eslint.config.mjs` |
| **Biome** | `lint:biome` | Biome rule violation | `biome.json` |
| **Architecture** | `lint:architecture src/Scrapers/Pipeline` | Cross-layer import violation | Lives under `src/Tests/Tools/lint-and-validate.ts` |
| **Canaries** | `lint:canaries` | One of the 33 TypeScript canaries didn't trigger its expected error | `src/Scrapers/Pipeline/EslintCanaries/verify.sh` |
| **Dead code** | `lint:dead-code` | Unused exports / unreachable code | `src/Tests/Tools/detect-dead-code.ts` |
| **Phase isolation lint** | `lint:phases:strict` | Phase H test code outside the allowed pattern | `src/Tests/Unit/Pipeline/CrossValidation/Phases/` |
| **Unit tests** | `test:unit` | 4807 tests; all must pass | `--testPathIgnorePatterns=E2eReal --testPathIgnorePatterns=E2eMocked` |
| **Pipeline + coverage** | `test:pipeline` | Coverage drops below 97/95/97/98 | `src/coverage/lcov-report/` |
| **Mock E2E** | `test:e2e:mock` | Fixture-driven E2E for 3 banks | `src/Tests/E2eMocked/` |
| **Mock suite (orchestrated)** | `test:mock` | `scripts/run-mock-suite.ts` driving all configured banks | Same fixtures |
| **Bank tests** | `test:e2e-factory-tests` | Phase H cross-bank factory drives every phase per bank | `src/Tests/Unit/Pipeline/CrossValidation/Phases/` |
| **Build** | `build` | `tsup` ESM + CJS bundle | `lib/index.{mjs,cjs,d.ts,d.cts}` produced |
| **PR body compliance** | n/a (server-side `actions/github-script`) | PR body missing one of the 3 mandatory sections (`## Why`, `## What`, `## Guideline compliance`) | `.github/workflows/pr-body-check.yml` — mirrored locally by [`npm run lint:pr-body`](pre-push.md) |

## Coverage thresholds

| Metric | Threshold | Source |
|---|---|---|
| Statements | ≥ 97% | `jest.pipeline.config.cjs` |
| Branches | ≥ 95% | same |
| Functions | ≥ 97% | same |
| Lines | ≥ 98% | same |

A PR that drops any threshold fails `test:pipeline`. The post-Commit-1 numbers (v8.4.0) are **97.20% / 95.23% / 97.19% / 98.45%**.

## Where to find logs

| Where it ran | Log location |
|---|---|
| Local `npm run <script>` | stdout |
| Pre-commit hook | `.pre-commit-output.log` at repo root (overwritten each run) |
| GitHub Actions | The PR's "Checks" tab → workflow logs |

## Forensic diagnostics artifacts

BLUF: public CI diagnostics are intentionally narrow. `FORENSIC_TRACE=true`
enables one per-run folder from `TraceConfig.getRunFolder` containing
`pipeline.log`, `network/*.json`, and screenshots, but the public artifact
uploads only `pipeline.log` and redacted `network/*.json`. Raster PNGs stay out
of public artifacts because they can contain rendered PII.

On failed real-E2E jobs, `.github/scripts/ci/upload-private-diagnostics.sh`
uploads the full run folder to the access-controlled OCI diagnostics store
when `OCI_DIAG_PAR_URL` is available. The step is best-effort and keeps
forked PRs green when the private upload secret is absent.

## What changed in v8.4

- 3 new ESLint canaries for BALANCE-RESOLVE boundary enforcement: `balance-resolve-isolation`, `no-balance-in-scrape`, `balance-fetch-only-in-balance-resolve`.
- 12 new tests in `BalanceResolveActionsCoverage.test.ts` + `BalanceResolvePhase.test.ts` + `ScrapePostDetectionBranches.test.ts` pushing branch coverage from 94.59% → 95.23%.
- TypeDoc output relocated from `docs/` to `typedoc-build/` so `docs/` can host mkdocs sources.
