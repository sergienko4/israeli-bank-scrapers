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
`baseline.json` writes the one snapshot that _is_ committed and that every
future diff compares against. `diff.mjs` prints a Markdown matrix suitable for
pasting into a PR body.

## What it measures

| Metric              | Meaning                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `fanIn` (afferent)  | How many modules import this one — the blast radius of changing it.           |
| `fanOut` (efferent) | How many modules this one imports — how much it needs to know.                |
| `instability`       | `fanOut / (fanIn + fanOut)`. `0` = stable contract, `1` = volatile leaf.      |
| `cohesion`          | Per cluster: `internal / (internal + outgoing)`. Low means the cluster leaks. |
| `importCycles`      | Strongly-connected components (Tarjan). Must stay `0`.                        |
| guardrails          | Canary count, ESLint rule count, `any` usages, `lib/index.cjs` hash.          |

## Runtime vs type-only edges — read this before drawing conclusions

Every edge is classified as `RUNTIME` or `TYPE_ONLY`. A `import type { X }`
edge is **erased at build time** and creates no runtime coupling — it only
affects recompilation scope.

This distinction is not cosmetic. `Types/PipelineContext.ts` has a fan-in of
373 and the highest fan-out in the repo, which looks like a god-module. Every
one of its imports is `import type`: it is a type barrel with **zero** runtime
coupling. Judging it on total edges would have produced a wrong verdict.

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
