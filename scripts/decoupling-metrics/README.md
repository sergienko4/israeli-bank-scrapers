# Decoupling metrics

Measures how coupled the codebase is, and proves whether a change made it
better or worse. Satisfies step **C5** of `post-pr-checklist.md`
("decoupling-metrics matrix snapshot + diff").

Previously this tooling lived in an ephemeral agent session folder, so it
vanished between sessions and C5 was repeatedly skipped. It now lives in the
repo so every contributor and every session can run it.

## Usage

```bash
# Capture a snapshot of the current checkout
node scripts/decoupling-metrics/measure.mjs . baseline

# Regenerate the committed baseline in place (no rename step needed)
node scripts/decoupling-metrics/measure.mjs . baseline baseline.json

# Compare two snapshots (before vs after a change)
node scripts/decoupling-metrics/diff.mjs \
  scripts/decoupling-metrics/snapshots/<before>.json \
  scripts/decoupling-metrics/snapshots/<after>.json
```

The third argument is an explicit output filename. Without it `measure.mjs`
writes `snapshots/<sha8>-<label>.json`, which stays gitignored; passing
`baseline.json` writes the one snapshot that _is_ committed. `diff.mjs` prints
a Markdown matrix suitable for pasting into a PR body.

## On a pull request, CI does this for you

The `Decoupling` job in `pr.yml` is a required dependency of `Validate`. It
measures the branch, measures the merge base in a worktree, and fails when a
ratchet goes backwards (import cycles, canaries, ESLint rules, `any` usages) or
average fan-out grows by more than 10%. The full matrix is posted to the job
summary.

It is skipped when the changed files cannot move the numbers — it runs only for
the `full_suite`, `metrics` and `ci_scripts` file groups, so a docs-only PR does
not pay for a measurement whose result is known in advance.

It compares against the **merge base**, not `baseline.json`, and that is
deliberate — see the next section. You do not need to run anything by hand to
get a per-PR verdict.

## Why the committed baseline is not the reference for a PR

`baseline.json` is a _rolling_ reference for judging `main` over time, not a
per-PR yardstick. Regenerate it on `main` after a merge so it keeps tracking
reality.

Left to drift, it silently stops answering the question it was built for. A
baseline eight days stale reported `+48 files / +138 runtime edges` for a PR
that touched no production code at all — that delta was every PR merged in
between, not the one under review. The verdict looked alarming and meant
nothing. That failure is exactly why the CI gate diffs against the merge base
instead.

To reproduce the gate's verdict locally, snapshot the merge base directly
rather than diffing against `baseline.json`:

```bash
git worktree add /tmp/base "$(git merge-base origin/main HEAD)"
node scripts/decoupling-metrics/measure.mjs /tmp/base pre pre.json
node scripts/decoupling-metrics/measure.mjs . post post.json
node scripts/decoupling-metrics/diff.mjs \
  scripts/decoupling-metrics/snapshots/pre.json \
  scripts/decoupling-metrics/snapshots/post.json
git worktree remove /tmp/base
```

The third argument names the output file; without it `measure.mjs` falls back to
`<sha>-<label>.json` and the paths above cannot be copied verbatim. `diff.mjs`
prints the matrix — to get the pass/fail verdict CI reports, run the gate
itself over the same two snapshots:

```bash
BASE_SNAPSHOT=scripts/decoupling-metrics/snapshots/pre.json \
HEAD_SNAPSHOT=scripts/decoupling-metrics/snapshots/post.json \
GITHUB_STEP_SUMMARY=/dev/stdout bash .github/scripts/ci/decoupling-compare.sh
```

Both snapshots are gitignored, so this leaves the committed baseline untouched.

## What it measures

| Metric              | Meaning                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `fanIn` (afferent)  | How many modules import this one — the blast radius of changing it.           |
| `fanOut` (efferent) | How many modules this one imports — how much it needs to know.                |
| `instability`       | `fanOut / (fanIn + fanOut)`. `0` = stable contract, `1` = volatile leaf.      |
| `cohesion`          | Per cluster: `internal / (internal + outgoing)`. Low means the cluster leaks. |
| `importCycles`      | Strongly-connected components (Tarjan). Must stay `0`.                        |
| guardrails          | Canary count, distinct ESLint rule count, `any` usages, `lib/index.cjs` hash. |

The ESLint figure counts **distinct rule names**, not declaration lines, so
re-scoping a rule cannot register as deleting one. It answers "did a rule leave
the config?" only. Whether each cluster's caps are still strict enough is
asserted directly by `lint:guideline-coverage`, which resolves the effective
config per cluster and fails by name when a cap goes missing or laxer — that is
what catches a deleted _scoped_ declaration, which this count cannot see.

That gate is **complete for the four numeric caps**: it resolves the effective
config for every production _file_ under `src/Common` and `src/Scrapers` — 862
of them — and fails unless each cap matches the expectation recorded across
`src/Tests/Tools/CapRegimeTable.ts` (the policy anchor) and
`src/Tests/Tools/CapOverrides.ts` (the per-path exceptions) exactly. The unit is
the file rather than the directory because this config also
scopes caps to individual filenames beside a differently-capped sibling
directory (`Strategy/Scrape/ScrapeExecutor.ts` next to `Strategy/Scrape/**`, for
one); sampling a single file per directory would leave those regimes unmeasured.
Exact matching is what catches a deleted block that pins a drained sub-tree back
to the canonical cap — for example `Strategy/Scrape/Executor/**`, which `§19.1`
would otherwise leave grandfathered at 40 LoC per function. It also catches the
reverse: draining a tree without recording it, which `eslint-rules-guidlines.md`
§1 requires in the same PR. Rules outside those four — notably scoped
`no-restricted-syntax` and `max-statements` — stay outside the reach of both
measures; removing one of those still needs review to catch.

The `lib/index.cjs` hash detects whether the **built bundle** changed. It is an
implementation-bundle hash, not a declaration-level API diff: a purely internal
edit changes it, and it cannot by itself prove the exported type surface is
unchanged. Treat a change as "confirm this was intended", not as "the public
API broke".

## Which files are measured

File discovery is delegated to git
(`git ls-files --cached --others --exclude-standard`), so the set is exactly
tracked files plus untracked-but-not-ignored ones. Gitignored scratch files
never enter a snapshot, which is what makes the committed baseline reproducible
on any clean checkout. Imports are parsed with the TypeScript compiler's AST,
not a regex, so the runtime/type-only split is accurate for mixed clauses such
as `import Foo, { type Bar } from './m'`.

## Runtime vs type-only edges — read this before drawing conclusions

Every edge is classified as `RUNTIME` or `TYPE_ONLY`. A `import type { X }`
edge is **erased at build time** and creates no runtime coupling — it only
affects recompilation scope.

This distinction is not cosmetic. `Types/PipelineContext.ts` has a fan-in of
373 and the highest fan-out in the repo, which looks like a god-module. In
fact 20 of its 25 outgoing edges are `import type`, and its 5 runtime edges
are value re-exports to sibling `Types/Domain/*` modules; only 15 of the 373
incoming edges are runtime. It is a type barrel, not a god-module. Judging it
on total edges would have produced a wrong verdict.

**Always read `runtimeSummary` / `runtimeClusters` when hunting coupling.** The
all-edge `summary` / `clusters` are kept only to show recompilation scope.

Import cycles are likewise computed on runtime edges only — type-level cycles
are legal in TypeScript and harmless.

## Known false positives

- **Test, script and canary clusters show near-zero cohesion.** That is
  correct by design: tests import production code, scripts are standalone, and
  `EslintCanaries` are deliberately isolated fixtures. Only production clusters
  carry signal.
- **Orchestration layers show low cohesion by design.** `Pipeline/Phases`,
  `Pipeline/Core` and `Pipeline/Strategy` are required to delegate outward —
  "a Phase should ONLY orchestrate, all logic via Mediator". Before treating
  low cohesion as leakage, check _where_ the outgoing edges land: edges into
  `Pipeline/Types` (stable contracts) and `Pipeline/Mediator` are the intended
  shape, not a defect.
- **A cluster with no edges at all reports cohesion `1`.** Cohesion is
  `internal / (internal + outgoing)`, which is undefined when both are zero, so
  the code returns `1`. Type-only folders such as `Scrapers/Base/Interfaces`
  therefore show a perfect score while carrying **no cohesion signal
  whatsoever**. Read `internalEdges` and `outgoing` before trusting a `1`.
- **`any` usages count the whole repo**, including root-level debug scripts —
  not just `src/`. Comments are stripped before counting, so JSDoc prose such
  as "Best-effort: any throw is swallowed" is not miscounted.

## Design notes

The graph is built **directly from source**, not from the `.understand-anything`
knowledge graph, so the numbers stay valid even when that graph is stale.

Module resolution follows this project's ESM convention: a `./Foo.js`
specifier inside a `.ts` file resolves to `Foo.ts` (also `.tsx`, `.mts`,
`.cts`, and `/index.*`).

When a file imports the same target both as a type and as a value, the edge is
recorded as `RUNTIME` — the stronger of the two.
