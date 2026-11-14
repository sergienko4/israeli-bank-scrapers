# 🛠️ Clean Code Guide — Canonical Quality Caps

This file is the **single source of truth** for the per-function /
per-file quality caps enforced by `eslint.config.mjs`. Every other
doc (`CLAUDE.md`, `.code-rules.md`, `docs/contributing/lint.md`)
links here — do NOT restate the numbers elsewhere.

This project enforces quality limits automatically on every commit.
When ESLint blocks your commit, find your error below and apply the fix.

The pre-commit gate `lint:guideline-coverage` ALSO asserts that
`eslint.config.mjs` actually enforces these caps for every Pipeline
cluster — so the doc/config mismatch that caused CR cycle-1 #7 on
PR #278 can never recur.

---

## Canonical caps (enforced by ESLint + `lint:guideline-coverage`)

| Cap                   | Value                             | Rule                            | Scope                          |
| --------------------- | --------------------------------- | ------------------------------- | ------------------------------ |
| File size             | **150** effective LoC             | `max-lines`                     | All production `src/**`        |
| Per-function LoC      | **≤ 10** (hard cap)               | `max-lines-per-function`        | All production `src/**`        |
| Cyclomatic complexity | **10**                            | `complexity`                    | All production `src/**`        |
| Parameter count       | **3** (use options object beyond) | `@typescript-eslint/max-params` | All production `src/**`        |
| Nesting depth         | **1**                             | `max-depth`                     | All `src/Scrapers/Pipeline/**` |
| Classes per file      | **1**                             | `max-classes-per-file`          | All `src/**`                   |

Every production tree (`src/index.ts`, `src/Common/**`, `src/Scrapers/Base/**`,
`src/Scrapers/Registry/**`, and every `src/Scrapers/Pipeline/**` cluster)
enforces `max-lines: 150` and `max-lines-per-function: 10` universally with
zero grandfather overrides in `eslint.config.mjs` or
`src/Tests/Tools/CapOverrides.ts`.

> **Parameter count.** Multi-line typed signatures do NOT relax the
> global ≤ 3-parameter cap (`@typescript-eslint/max-params`, row 4 of
> the table above). Multi-line signatures exist only because the typed
> parameter list of a 3-arg function exceeds the 100-char line cap;
> functions that need more than three inputs MUST bundle the extras into
> a `Readonly<{...}>` options object (the `IFooArgs` pattern used
> throughout `Mediator/**`).

> **Footnote — historical "ideal vs hard" and grandfather terminology.**
> Earlier phases of this codebase used "10 ideal / 20 hard" language and
> temporary per-cluster grandfather blocks while clusters were drained
> one at a time. All grandfather overrides have been retired: every
> production module now enforces ≤ 10 LoC per function and ≤ 150
> effective LoC per file as universal hard caps, verified on every
> commit by `npm run lint:guideline-coverage` and Canary fixtures.

---

## 1. Function too long (`max-lines-per-function`)

**Rule:** ≤ 10 LoC per function as a hard cap (CLAUDE.md +
`coding-principle-guidlines.md` "Max 10 lines per method"). Cluster-
specific blocks in `eslint.config.mjs` can tighten the cap further
(some canaries pin to 5–8) but never weaken it. The legacy "10
ideal / 20 hard" terminology is retired — see the footnote above
the table.

**The Fix — Extract Method:**
Break the function into smaller helpers, each with a descriptive name.

```typescript
// ❌ One 25-line function doing too much
async function handleLogin(page: Page, creds: Credentials): Promise<void> {
  await page.goto(LOGIN_URL);
  await page.waitForSelector('#username');
  await page.fill('#username', creds.username);
  await page.fill('#password', creds.password);
  await page.click('#submit');
  await page.waitForNavigation();
  const url = page.url();
  if (url.includes('error')) throw new Error('Login failed');
  // ... 15 more lines of post-login setup
}

// ✅ Split into focused helpers
async function navigateToLogin(page: Page): Promise<void> {
  await page.goto(LOGIN_URL);
  await page.waitForSelector('#username');
}

async function fillCredentials(page: Page, creds: Credentials): Promise<void> {
  await page.fill('#username', creds.username);
  await page.fill('#password', creds.password);
  await page.click('#submit');
  await page.waitForNavigation();
}

function assertLoginSuccess(url: string): void {
  if (url.includes('error')) throw new Error('Login failed');
}
```

---

## 2. Too many parameters (`@typescript-eslint/max-params`)

**Rule:** Max 3 parameters. Beyond that, use an **Options Object**.

```typescript
// ❌ 4 parameters — hard to read and call
function fetchTransactions(
  accountId: string, startDate: Date, endDate: Date, includeRaw: boolean
): Promise<Transaction[]> { ... }

// ✅ Options object with a named interface
interface FetchTransactionsOptions {
  accountId: string;
  startDate: Date;
  endDate: Date;
  includeRaw?: boolean;
}

function fetchTransactions(options: FetchTransactionsOptions): Promise<Transaction[]> { ... }
```

---

## 3. Too complex (`complexity`)

**Rule:** Cyclomatic complexity ≤ 10. Each `if/else/switch/while` adds +1.

**The Fix — Guard Clauses (Early Return):**
Invert conditions to exit early instead of deep nesting.

```typescript
// ❌ Deeply nested — complexity = 6
function processAccount(account: Account | null): string {
  if (account) {
    if (account.isActive) {
      if (account.balance > 0) {
        return formatBalance(account.balance);
      } else {
        return 'Zero balance';
      }
    } else {
      return 'Inactive';
    }
  } else {
    return 'No account';
  }
}

// ✅ Guard clauses — complexity = 3, reads like English
function processAccount(account: Account | null): string {
  if (!account) return 'No account';
  if (!account.isActive) return 'Inactive';
  if (account.balance <= 0) return 'Zero balance';
  return formatBalance(account.balance);
}
```

---

## 4. Multiple classes in one file (`max-classes-per-file`)

**Rule:** One class per file. Keeps modules focused and easy to find.

```
// ❌ src/scrapers/banks.ts  ← contains BankA + BankB + BankC

// ✅
src/scrapers/bank-a.ts    ← class BankAScraper
src/scrapers/bank-b.ts    ← class BankBScraper
```

---

## 5. Hardcoded sentinel literals (PiiRedactor §13 only)

**Rule:** Per-category PiiRedactor modules must NEVER hardcode
`'[REDACTED]'`, `'[OTP]'`, or `'[REDACTION_ERROR]'` literals.
Import the matching constant from `Types.ts` instead.

```typescript
// ❌ banned (CR cycle-1 #9)
return '[REDACTED]' as PiiHintString;

// ✅ allowed
import { REDACTED_HINT } from './Types.js';
return REDACTED_HINT as PiiHintString;
```

The canary `pii-hardcoded-sentinel.canary.ts` keeps the rule alive.

---

## 6. Unused imports (`unused-imports/no-unused-imports`)

**The Fix — auto-clean:**

```bash
npm run lint:fix
```

This removes unused imports automatically. Run it before committing.

---

## Quick Reference

| Error                              | Command to fix                    |
| ---------------------------------- | --------------------------------- |
| Unused imports                     | `npm run lint:fix`                |
| Prettier formatting                | `npm run format`                  |
| All auto-fixable                   | `npm run lint:fix`                |
| See all errors                     | `npm run lint`                    |
| Verify ESLint covers every cluster | `npm run lint:guideline-coverage` |

---

## Pre-commit flow

`.husky/pre-commit` is the source of truth; its output goes to
`.pre-commit-output.log`.

```text
git commit
  → skip filter: no source files staged (only .md / .json / .yml /
    .yaml, LICENSE, dotfiles, .github/, .husky/, tasks/)?
      → lint:plan-refs on the staged additions
      → commit succeeds ✅ (no other gate runs)
  → Phase 1: prettier --write on staged src/ files, then re-stage
  → Phase 2: every gate in parallel, cached per staged tree
    (cache off while unstaged changes exist):
      tsc, cycles, fixtures-pii, pii-staged, plan-refs (not cached)
      + eslint, biome   on the staged src/ code files (whole src
                        above 50 files)
      + architecture    on the staged src/ files (whole src above 50)
  → commit succeeds ✅ or lists every failed gate ❌
```

ESLint reports only — the hook never runs `eslint --fix`. Every repo-wide
gate runs in CI instead of the hook: the build and public-surface check,
full ESLint and Prettier, both type checks, guardrails, canaries,
guideline coverage, dead code, test duplication, Jest scopes, CodeRabbit
filters, Node support, audit and the docs gates, plus the test suites
(`test:pipeline`, `test:e2e:mock`, `test:e2e-factory-tests`), the
Integration shards and the environment-gated E2E Real jobs.
`HookGatesInCi.test.ts` fails if a gate left in the hook has no CI step.
`test:mock` has no CI job, and its runner is a git-ignored local script
that is not committed, so `npm run test:mock` cannot run from a clean
checkout.
