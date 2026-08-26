# Docs coverage gate

Fails CI when a **new** public export under `src/Scrapers/Pipeline/` ships
without any mention in `docs/`.

| | |
|---|---|
| Driver | `.github/scripts/ci/docs-coverage.sh` |
| Extractor | `.github/scripts/ci/extract-exports.sh` |
| Extractor test | `.github/scripts/ci/tests/extract-exports.test.sh` |
| Allowlist | `.github/docs-coverage-allowlist.txt` |
| CI step | `Docs coverage canary` in `.github/workflows/pr.yml` |
| Local | pre-commit gate 12 (soft-skips when the base ref is unresolvable) |

## What it compares

The gate diffs **symbol sets**, not diff lines:

```text
NEW = exports(HEAD:file) \ exports(BASE_SHA:file)
```

Only `NEW` symbols are checked. That has two consequences worth
internalising:

- Reformatting, moving, or rewriting an already-exported symbol is free —
  the name exists on both sides, so it never enters `NEW`.
- **Pre-existing undocumented exports are grandfathered.** They exist on
  the base branch too, so widening what the extractor can see does not
  retroactively fail anything. The gate is a ratchet, not an audit.

## Which export forms count

An export counts when the file is the symbol's **definition site**.

| Form | Example | Counted |
|---|---|---|
| Inline declaration | `export const Foo = …` | Yes |
| Local export list | `export { Foo };` | Yes |
| Local type export list | `export type { Foo };` | Yes |
| Aliased local export | `export { internal as Foo };` | Yes — as `Foo` |
| Re-export barrel | `export { Foo } from './bar.js';` | No — by design |
| Star re-export | `export * from './bar.js';` | No |
| Default export | `export default …` | No — no symbol name |

Barrels are excluded deliberately: the symbol is *defined* somewhere else
and is charged to that file, so counting it again in the barrel would
demand the same doc entry twice.

Nested declarations are also excluded — the inline pattern is anchored at
column 0, so a `export const` inside a namespace or class body is not
mistaken for a top-level export.

## The 2026-08 blind spot

Until August 2026 the extractor understood the inline form only. Its
regex ended in `[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)`, and because `{` is
not in `[A-Za-z_]`, every `export { Foo };` matched nothing.

Measured across the gate's own scope at the time of the fix:

| | Files | Share |
|---|---:|---:|
| Visible (inline exports) | 250 | 32% |
| **Blind (local export list)** | **460** | **58%** |
| Re-export barrels (excluded by design) | 38 | 5% |
| No exports at all | 42 | 5% |
| **Total in scope** | **790** | |

1,374 symbols sat behind the blind spot.

The failure was not theoretical. PR #517 added `RenderHealth.ts` and
`ElementIdentity.ts` — both brand-new files, both using the local list
form, so *every* symbol in them was `NEW`. The gate reported **1** new
export across the whole PR and passed. CodeRabbit then flagged those very
exports as undocumented by hand.

Replaying the fixed extractor against that same commit surfaces **12**
new exports instead of 1, including the ones CodeRabbit had to catch:
`elementPathToken`, `readElementIdentity`, `UNKNOWN_IDENTITY`,
`measureRenderHealth`, `isRenderedFrom`, `BLANK_PAGE_MAX_ELEMENTS`,
`BLANK_PAGE_MAX_BODY_HEIGHT_PX`, and the `IRenderCounts` /
`IRenderHealth` / `RenderProbeStatus` types.

Because the gate only ever looks at `NEW`, closing the blind spot did not
create a backlog — it only means a newly added list-form export now has
to be documented like any other.

## Satisfying the gate

Two options when it fails:

1. **Document the symbol.** Any mention under `docs/` counts; a whole-word
   match is enough. Prefer the page that already covers the module.
2. **Allowlist it** in `.github/docs-coverage-allowlist.txt`, one symbol
   per line, with a `# Reason:` comment above it. Reserve this for symbols
   that are intentionally exported but genuinely not user-facing.

## Verifying a change to the extractor

The extractor lives in its own sourceable file specifically so its test
drives the real implementation rather than a copy of it — a gate whose
test re-implements the gate proves nothing.

```bash
bash .github/scripts/ci/tests/extract-exports.test.sh
```

To replay the gate against a historical commit, add a detached worktree
at that commit and point `BASE_SHA` at its parent:

```bash
git worktree add --detach /tmp/replay <commit>
cd /tmp/replay
BASE_SHA=$(git rev-parse <commit>^) BASE_REF=main \
  bash .github/scripts/ci/docs-coverage.sh
```
