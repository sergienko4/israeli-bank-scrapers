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

BLUF: CI diagnostics never leave the access-controlled private store.
`FORENSIC_TRACE=true` enables one per-run folder from
`TraceConfig.getRunFolder` containing `pipeline.log`, `network/*.json`, and
screenshots. On a failed real-E2E job that whole folder uploads only to the
private OCI diagnostics store — nothing goes to a public GitHub artifact,
because the bundle can carry rendered PII.

On failed real-E2E jobs, `.github/scripts/ci/upload-private-diagnostics.sh`
uploads the full run folder to the access-controlled OCI diagnostics store
when `OCI_DIAG_PAR_URL` is available. The step is best-effort and keeps
forked PRs green when the private upload secret is absent.

Object keys are laid out `<bank>/<run_id>-<run_attempt>/forensic-<bank>-<tag>.zip`,
so each CI run groups under its own `<run_id>-<run_attempt>` segment.

### Retention

BLUF: a one-time bucket **Lifecycle Policy** deletes diagnostics older than
**7 days** server-side; CI never deletes, because the PAR cannot.

OCI Pre-Authenticated Requests grant only `GET` (read) and `PUT`
(write/overwrite) — **no PAR access type can issue an HTTP `DELETE`**. The CI
job therefore only ever uploads; it cannot prune the bucket with
`OCI_DIAG_PAR_URL`. Retention is enforced outside the upload step:

- **Age — active.** A server-side **Object Lifecycle Policy** on the
  diagnostics bucket deletes objects 7 days after creation. Set once in the
  OCI Console (Bucket → _Lifecycle Policy Rules_ → _Create Rule_ → Action
  **Delete**, Target **Objects**, **7** days) or via
  `oci os object-lifecycle-policy put`. No CI code, no extra secret, runs
  daily server-side.
- **Count — keep newest 5 runs — deferred.** Count-based pruning needs a real
  `DeleteObject` call, which a PAR cannot make. It is deferred until an OCI
  API-key secret is added to CI; the prune would then list + delete via
  `oci os object`, grouping by the `<run_id>-<run_attempt>` key segment and
  keeping the 5 newest run tags.

## What changed in v8.4

- 3 new ESLint canaries for BALANCE-RESOLVE boundary enforcement: `balance-resolve-isolation`, `no-balance-in-scrape`, `balance-fetch-only-in-balance-resolve`.
- 12 new tests in `BalanceResolveActionsCoverage.test.ts` + `BalanceResolvePhase.test.ts` + `ScrapePostDetectionBranches.test.ts` pushing branch coverage from 94.59% → 95.23%.
- TypeDoc output relocated from `docs/` to `typedoc-build/` so `docs/` can host mkdocs sources.
