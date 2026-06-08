# Code style & lint

The pre-commit hook runs ESLint + Biome + Prettier + the architecture validator + canaries + guideline-coverage on every commit. Skipping any of them is not an option.

> **Quality caps** (per-function LoC, file size, complexity, parameter count) live in [CLEAN_CODE.md](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/CLEAN_CODE.md). That file is the single source of truth — do NOT restate the numbers here. The `lint:guideline-coverage` gate asserts `eslint.config.mjs` actually enforces those caps for every Pipeline cluster.

## Project-specific rules (beyond defaults)

### SOLID + OCP

Open-closed pattern enforced via `eslint.config.mjs` `max-depth: 1` and `complexity` rules.

| Banned | Allowed |
|---|---|
| `if (bank === 'amex') {} else if (...) {}` ladders | Lookup table — `MAP[bank]?.(...)` |
| Functions over the cluster cap (see CLEAN_CODE.md) | Extract helpers |
| `class` extension chains | Composition + declarative config |

### No CSS selectors in interaction code

| Banned in interaction code | Allowed |
|---|---|
| `page.$$('div#login')`, `$eval`, `querySelector` | `getByText`, `getByRole`, `getByPlaceholder` (Playwright text-first) |
| Hardcoded `#login-form`, `.btn-submit` strings | The 7-strategy `SelectorResolver` |
| `waitForSelector('#id')` | `waitForText` / `waitForRole` |

CSS selectors **are** allowed in parsing / extraction code (table walks, date-picker grids, etc.) — the rule targets user-facing flow only.

### No `null` / `undefined` returns

| Banned | Allowed |
|---|---|
| `function foo(): T | null` | `function foo(): Procedure<T>` |
| `return null;`, `return;`, `return undefined;` | `return succeed(value);` / `return fail(type, msg);` |
| `value!` non-null assertion | Optional chaining + explicit guard |

### No raw PII in logs

| Banned | Allowed |
|---|---|
| `LOG.info(\`account ${accountId}\`)` | `LOG.info({ account: maskTail4(accountId) })` |
| `LOG.debug({ result })` (whole payload) | `LOG.debug({ stage: 'final', resolvedCount })` |
| `console.log(...)` (any) | Use the typed logger |

### No `throw new Error` across module boundaries

| Banned | Allowed |
|---|---|
| `throw new Error('...')` | `throw new ScraperError('...')` |
| | `return fail(ScraperErrorTypes.Generic, '...')` (preferred in pipeline code) |

### No nested call expressions

The `no-restricted-syntax` rule blocks `foo(bar(x))` patterns (where `bar(x)` is the argument to `foo`). Extract intermediate variables for debuggability:

```typescript
// ❌ banned
expect(isOk(result)).toBe(true);

// ✅ allowed
const isSuccess = isOk(result);
expect(isSuccess).toBe(true);
```

Test files have the [`assertOk`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Tests/Helpers/AssertProcedure.ts) helper for this exact pattern.

## Auto-fix vs hand-fix

| Tool | Auto-fix command | What it handles |
|---|---|---|
| Prettier | `npm run format` | Whitespace, quotes, trailing commas, line wraps |
| ESLint | `npm run lint:fix` | Import order, unused imports, trivial style |
| Biome | `npx biome check src --write` | Some safe semantic fixes (organise imports, simplify expressions) |

Architecture violations + canaries + dead code must be **hand-fixed**. They flag invariant breaks, not style.

## Common errors and their fixes

| Error | Fix |
|---|---|
| `File has too many lines (N). Maximum allowed is 600` | Split the file — extract a `*Helpers.ts` or `*Branches.test.ts` |
| `🚫 FORBIDDEN NESTED CALL` | Extract the nested call to a variable |
| `🚫 ARCHITECTURE: Functions cannot return 'null' or 'undefined'` | Switch to `Procedure<T>` |
| `Do not use 'throw new Error()'` | Use `ScraperError` (or `fail()` if you're in pipeline code) |
| `🚫 TYPE SKIP: Do not declare variables as 'unknown'` | Cast to the concrete type immediately at the boundary |
| `🚫 LINT SKIP: Do not disable ESLint rules` | Don't use `// eslint-disable` — fix the underlying issue |

## When in doubt

Read the [Architecture → Layer separation](../architecture/layers.md) page first. Most surprise-violations come from accidentally importing across a layer boundary; the fix is usually moving a helper, not silencing the rule.
