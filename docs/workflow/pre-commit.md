# Pre-commit hook

Driven by [husky](https://typicode.github.io/husky/). Runs a small set of fast
gates before a commit lands locally: the checks scoped to what you staged, and
the checks that stop a leak before it enters history. Every repo-wide gate runs
in CI on the pull request instead — see [What runs only in CI](#what-runs-only-in-ci).

| Source | [`.husky/pre-commit`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/.husky/pre-commit) |
|---|---|

## Phase 1 — Prettier autoformat

Runs first and auto-fixes whitespace / quote style / trailing commas on the
staged `src/` files, then re-stages them. The gate cache key is computed *after*
this step so cosmetic fixes don't invalidate the cache.

## Phase 2 — gates in parallel

The hook spawns each gate as a background process and `wait`s for them all.
Cache key per gate is `git write-tree` (the SHA of the staged tree); when the
same SHA passes a gate, the next commit on the same content set skips it. The
cache is off while tracked files have unstaged changes. `eslint`, `biome`,
`architecture` and `plan-refs` are never cached: they read the staged file list
or additions, which depend on `HEAD` as well as on the staged tree.

A commit that stages no source file — only docs, workflows, `.json`/`.yml`
config or dotfiles — skips this phase and runs only `plan-refs`.

| # | Gate | Hook label | What it runs |
|---|---|---|---|
| 1 | TypeScript | `tsc` | `type-check` — the whole program, in seconds with the TypeScript 7 native compiler |
| 2 | ESLint | `eslint` | `eslint --max-warnings 0` on the staged `src/` `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs` files; the whole `src` tree when more than 50 are staged |
| 3 | Biome | `biome` | `biome lint` on the same staged files |
| 4 | Architecture | `architecture` | `lint-and-validate.ts` on the staged `src/` files; the whole `src` tree when more than 50 are staged (see [architecture-linter.md](architecture-linter.md)) |
| 5 | Import cycles | `cycles` | `lint:cycles` — the whole import graph, about two seconds |
| 6 | Fixture PII | `fixtures-pii` | `lint:fixtures-pii` |
| 7 | Staged PII | `pii-staged` | `lint:pii-staged` on the staged diff |
| 8 | Plan refs | `plan-refs` | `lint:plan-refs` on the staged additions (an item number, decision ID, task number or section mark from a local, uncommitted plan; fixtures, captured pages, lockfiles and the changelog are skipped) |

A staged `eslint.config.mjs`, `eslint/**` or `biome.json` prints a note: a lint
config edit can change the verdict on files nobody staged, which only CI's full
run sees.

## What runs only in CI

Every gate below runs in the `Static checks` or `Package & E2E factory` job of
[`pr.yml`](ci.md) on every pull request it can affect.
`HookGatesInCi.test.ts` also fails if a gate left in the hook has no CI step.

| Gate | CI step |
|---|---|
| Full ESLint over `src`, Prettier check, both type checks | `Static checks` |
| Restricted-syntax guardrails, architectural canaries, guideline coverage | `Static checks` |
| Dead code, test duplication, Jest scopes, CodeRabbit filters, Node support | `Static checks` |
| PII on the pull request's additions (`lint:pii-staged` with `BASE_SHA`) | `Static checks` |
| npm audit, docs coverage, docs staleness, docs strict build, links | `Static checks` |
| `tsup` build, public API surface, package exports | `Package & E2E factory` |
| Unit, policy, mocked E2E and coverage suites | `Unit tests`, `E2E mocked` |

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
  ...
❌ FAILED GATES: tsc biome
```

The summary at the end names every failing gate. Detail logs are written to
`.pre-commit-output.log` at repo root (overwritten each run).

## Why these gates are local

| Gate | Role |
|---|---|
| `tsc` + `eslint` + `biome` + `architecture` + `cycles` | Fast feedback on the files you changed: type errors, rule violations, layer reach-throughs and import cycles are the commonest breaks |
| `fixtures-pii` + `pii-staged` + `plan-refs` | A leak cannot be taken back once pushed, so these stop it before it enters history. CI runs them again over the whole pull request |

### Privacy gates

- `fixtures-pii` fails when captured fixtures carry any of:
    - real account data or person names
    - live session or anti-forgery tokens
    - a bot-manager session UUID, alone or embedded mid-value
    - last-login stamps
    - a client IP, plain or embedded in a bot-manager token
- It reports at most 15 CRITICAL or HIGH hits per fixture, and counts any further hits.
- Each hit shows only its rule, severity, line:column and match length, never the matched text, because the hook keeps its output in `.pre-commit-output.log`.
- `pii-staged` fails when any staged file re-adds a known scrubbed value from the hashed denylist. In CI the same script scans the pull request's additions.

## Skipping the hook (don't)

The husky hook can be bypassed with `--no-verify`. Don't. CI runs every gate
the hook runs and more, and will reject the PR anyway, wasting your iteration
time.

## What happens on hook failure

The commit is **not** created — `git status` still shows your changes staged. Fix the issues, re-stage, retry. There's no half-state to clean up.
