# CI gates

GitHub Actions runs these gates on every PR, except for the heavier jobs that
are skipped when the changed files cannot affect them —
`.github/scripts/ci/detect-changes.sh` classifies the diff and each job's `if:`
in `pr.yml` states its own condition. The matrix below is the source of truth.

Post-merge is a different pipeline: one `Main Pipeline` run per merge — scans
and release together — covered in
[Main pipeline (post-merge CI)](main-pipeline.md).

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
| **Memory** | `test:memory` | Peak memory grows more than 10% against the merge base | `.github/scripts/ci/memory-measure.sh` + [`memory-compare.sh`](#memory-regression-gate) |
| **Decoupling** | n/a (`scripts/decoupling-metrics/measure.mjs`) | A new import cycle, a new `any`, a deleted canary or ESLint rule, or fan-out growing more than 10% | [`decoupling-compare.sh`](#decoupling-regression-gate) |
| **PR body compliance** | n/a (server-side `actions/github-script`) | PR body missing one of the 3 mandatory sections (`## Why`, `## What`, `## Guideline compliance`) | `.github/workflows/pr-body-check.yml` — mirrored locally by [`npm run lint:pr-body`](pre-push.md) |
| **Cited paths** | `lint:doc-paths` | An agent doc or PR body cites a repo path that does not exist | `scripts/check-doc-paths.mjs` — see [Doc path gate](doc-paths.md) |

## Memory regression gate

BLUF: the gate compares this PR against its own merge base, not against a
fixed ceiling.

Peak memory depends on the runner's CPU count, kernel and Node build, so an
absolute megabyte limit drifts and eventually fails for reasons that have
nothing to do with the change under review. The `Memory` job instead measures
**both** sides in the same job on the same runner, which cancels the machine
out, and fails only when the PR's peak grows by more than `THRESHOLD_PCT`
(default 10%).

The job runs when a PR touches source, dependencies, the test configuration or
the CI scripts themselves (`full_suite`, `deps`, `test_config`, `ci_scripts`).
A docs-only PR cannot move memory, so it is skipped rather than measured twice
to prove nothing.

| Knob | Default | Meaning |
| --- | --- | --- |
| `MEMORY_WORKLOAD` | `test:memory` | The npm script that gets measured |
| `MEMORY_SAMPLES` | `3` | Runs per side; the **lowest** is kept |
| `THRESHOLD_PCT` | `10` | Growth above this percentage fails the gate |

Two details worth knowing when reading a result:

- **Peak resident set size**, read from `/usr/bin/time -v`, is the largest
  resident set reached by any _single_ process in the tree — the parent or any
  Jest worker — not the sum of the concurrent ones. That catches a process
  that grows, which is what a leak looks like, but not memory spent purely by
  running more workers side by side. `process.memoryUsage()` inside Node would
  miss the workers entirely.
- **The lowest sample wins.** Peak memory is noisy upward (GC timing, page
  cache pressure, a slow worker start) and never downward, so the minimum is
  the most stable estimate of what the code actually needs. On `ubuntu-24.04`
  the first sample runs about 30% above the rest on both sides — a cold-start
  effect that the minimum discards.

If either side cannot be measured, the gate reports "not measured" and
passes. A measurement that never happened must not masquerade as a 0 MB win,
and must never block a PR for a reason its author cannot act on.

Reproduce a comparison locally:

```bash
BASE_MB=512 HEAD_MB=600 THRESHOLD_PCT=10 \
GITHUB_STEP_SUMMARY=/dev/stdout bash .github/scripts/ci/memory-compare.sh
```

## Decoupling regression gate

BLUF: guardrails are ratchets. They may get stronger on any PR; they may
never get weaker.

The `Decoupling` job measures the architecture of the PR **and** of its merge
base, using HEAD's copy of the measuring tool for both sides so a change to
the tool cannot masquerade as a change in the code. `measure.mjs` parses
TypeScript, so HEAD's dependencies are installed before it runs. The base
worktree needs no install of its own: it is only ever read by HEAD's tool.

Comparison is against the merge base rather than the committed
`snapshots/baseline.json`. That baseline is a rolling reference refreshed by
hand, so it drifts behind `main`; diffing against a stale one measures
everything merged since it was taken instead of what this PR did.

| Metric | Kind | Fails when |
|---|---|---|
| Runtime import cycles | ratchet | increases |
| `any` usages | ratchet | increases |
| ESLint canaries | ratchet | decreases |
| ESLint rules | ratchet | decreases |
| Avg runtime fan-out | tolerance | grows more than `THRESHOLD_PCT` (default 10%) |
| Files, runtime edges | context | never — reported to explain the rows above |

The split is deliberate. A guardrail has no legitimate "slightly weaker"
state, so those four have no tolerance band at all: deleting a canary or an
ESLint rule fails the PR outright, which is the
[never-weaken-a-rule guideline](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/CLEAN_CODE.md)
made executable. Coupling is different — files and edges grow whenever a
feature lands, so only the _average_ fan-out is bounded, and only against a
generous band that catches new code being markedly more coupled than the code
already there.

Exit codes distinguish two situations that must not be collapsed:

- **A snapshot is missing** (exit 0). The base tree could not be materialised —
  for instance on a PR that is not cleanly mergeable. Reported, never blocking.
- **A snapshot is present but unparseable** (exit 2). The measuring tool
  produced garbage; failing loudly is what stops a broken tool from silently
  disabling the gate.

The job also appends the full cluster-level matrix from `diff.mjs` to the run
summary, so per-cluster LoC, cohesion and fan-out shifts are visible without
running anything locally.

Reproduce a comparison locally:

```bash
node scripts/decoupling-metrics/measure.mjs . head head.json
git worktree add ../base "$(git merge-base origin/main HEAD)"
node scripts/decoupling-metrics/measure.mjs ../base base base.json
BASE_SNAPSHOT=scripts/decoupling-metrics/snapshots/base.json \
HEAD_SNAPSHOT=scripts/decoupling-metrics/snapshots/head.json \
GITHUB_STEP_SUMMARY=/dev/stdout bash .github/scripts/ci/decoupling-compare.sh
```

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
| GitHub Actions (PR) | The PR's "Checks" tab → workflow logs |
| GitHub Actions (after merge) | The [`Main Pipeline`](main-pipeline.md) run → summary table names the failing stage |

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
