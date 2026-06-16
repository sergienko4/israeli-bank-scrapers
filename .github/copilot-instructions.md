# Copilot Project Instructions — israeli-bank-scrapers (fork)

Fork of `eshaham/israeli-bank-scrapers` with Camoufox/Playwright WAF bypass,
published as `@sergienko4/israeli-bank-scrapers`.

> **Canonical rule sources (do not duplicate — defer to these):**
> [`CLAUDE.md`](../CLAUDE.md) (architecture + workflow) and
> [`CLEAN_CODE.md`](../CLEAN_CODE.md) (per-function/file/complexity/param caps)
> are the single source of truth. The lifecycle skills in
> [`.github/skills/`](skills/) are thin phase entry points that **point back**
> to these and to the enforcing gates — they never restate the rules.

## Development lifecycle (phase map)

Every non-trivial change flows through these phases. Each phase has an
auto-activating skill in `.github/skills/<phase>/SKILL.md` and (in the CLI) an
invokable command in `.claude/commands/<phase>.md`.

| Phase | Skill / command | Principle | Enforced by |
|-------|-----------------|-----------|-------------|
| DEFINE | `spec` | Spec before code | `tasks/*.md`, `new-task` |
| PLAN | `plan` | Small, atomic tasks | `plan.md`, GitHub Project, `start-task` |
| BUILD | `build` | One slice at a time | `npm run build`, ESLint caps, `CLEAN_CODE.md` |
| VERIFY | `test` | Tests are proof | `npm test`, `npm run lint:cycles`, `validate` |
| REVIEW | `review` | Improve code health | `npm run lint`, `improve`, rubber-duck, CodeRabbit |
| SIMPLIFY | `code-simplify` | Clarity over cleverness | `code-simplification-guidlines.md`, `improve` |
| SHIP | `ship` | Faster is safer | 21 husky gates, `lint:pr-body`, `gh pr create`, release-please |

## Boundaries

- **Always:** run the phase's gate before moving on; validate user input at
  boundaries; keep formatting changes separate from behavior changes.
- **Ask first:** new dependencies, schema/public-API changes, anything
  weakening an ESLint cap or gate.
- **Never:** `git commit --no-verify`, `git add .`, skip a husky gate, commit
  secrets, remove a failing test, or restate `CLAUDE.md`/`CLEAN_CODE.md` rules
  in a way that can drift from them.

## Architecture (see `CLAUDE.md` for the full set)

- **ZERO CSS selectors in interaction code** — find elements by visible text
  (`getByText`/`getByRole`/`getByPlaceholder`); structural selectors allowed
  only in parsing/extraction.
- SOLID, OCP via maps over if/else, factories over duplication.
- TypeScript strict — no `any`, no unused vars.
- Acyclic dependencies — the import-cycle gate (`npm run lint:cycles`) is a
  baseline ratchet; never widen it to introduce a cycle.
