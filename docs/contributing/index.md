# Contributing

> **Who this is for:** anyone who wants to fix a bug, add a feature, port a legacy bank, or improve docs.

## In this section

| Page | What it covers |
|---|---|
| [Adding a new bank](new-bank.md) | Step-by-step from `CompanyTypes` entry to declarative `PipelineBuilder` |
| [Test surfaces](testing.md) | Which test suite to write for what |
| [Code style & lint](lint.md) | Project rules: SOLID, max-depth, no CSS selectors, etc. |

See also: [CONTRIBUTING.md](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/CONTRIBUTING.md) at the repo root for the full PR checklist + Code of Conduct.

## Quick start (contributor)

```sh
# 1. Fork + clone
git clone https://github.com/<your-username>/israeli-bank-scrapers.git
cd israeli-bank-scrapers

# 2. Install
npm install            # also downloads Camoufox bundle (~500 MB)

# 3. Run tests
npm run test:unit      # fast — ~4 min
npm run lint           # eslint + architecture + canaries + format
npm run test:pipeline  # full coverage gates

# 4. Branch + commit
git checkout -b fix/whatever-im-fixing
# ... make changes ...
git commit -m "fix(scope): descriptive subject"   # husky runs 12 gates
git push -u origin fix/whatever-im-fixing

# 5. Open PR — CI re-runs the gates + bank tests
```

## How to find what you're looking for

| If you want to... | Read |
|---|---|
| Add a bank | [Adding a new bank](new-bank.md) |
| Add a phase | [Architecture → Pipeline](../architecture/pipeline.md) + [Phases → overview](../phases/index.md) |
| Fix a phase | The relevant [Phases](../phases/index.md) page + its source |
| Improve a test | [Test surfaces](testing.md) |
| Improve docs | This site is built from `docs/` — see `mkdocs.yml` for the nav + Material theme config |
| Port a legacy bank | [Architecture → Migration strategy](../architecture/migration.md) — the wave plan |

## What we expect in a PR

1. **One concern per PR** — bug fix XOR feature XOR refactor XOR docs. Don't mix.
2. **Conventional Commits** subject — `fix:`, `feat:`, `refactor:`, etc. See [Branch flow](../workflow/branch-flow.md).
3. **Tests** — new behavior needs new tests. Old behavior breaking needs old tests updated.
4. **No `any` / no `unknown` variables** — strict mode is enforced.
5. **No CSS selectors in interaction code** — use the 7-strategy `SelectorResolver`. CSS is OK in parsing/extraction code (table walks, date pickers).
6. **No `console.log`** — use the project's typed logger (Pino with the PII redactor wired in).
7. **Pre-commit hook must pass locally** — don't `--no-verify`.
