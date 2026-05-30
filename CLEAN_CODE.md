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

| Cap | Value | Rule | Scope |
|---|---|---|---|
| File size | **150** effective LoC | `max-lines` | All `src/Scrapers/Pipeline/**` |
| Per-function LoC | **10** ideal / **20** hard | `max-lines-per-function` | Per cluster (see below) |
| Cyclomatic complexity | **10** | `complexity` | All `src/Scrapers/Pipeline/**` |
| Parameter count | **3** (use options object beyond) | `@typescript-eslint/max-params` | All `src/Scrapers/Pipeline/**` |
| Nesting depth | **1** | `max-depth` | All `src/Scrapers/Pipeline/**` |
| Classes per file | **1** | `max-classes-per-file` | All `src/**` |

### Per-cluster `max-lines-per-function` (sourced from `eslint.config.mjs`)

| Cluster | Cap | Rationale |
|---|---|---|
| PiiRedactor (§13) | **10** | Matches CLAUDE.md ideal; each redactor is a tight strategy. |
| Network (§11) | **10** | Phase 8.5a drained the three grandfathered files and tightened the cap to match §13 / CLAUDE.md ideal. |
| Scrape (§12) | 20 | Same as Network. |
| Default §6C base | 15 | All other Pipeline files; can be overridden stricter. |

---

## 1. Function too long (`max-lines-per-function`)

**Rule:** Ideal = 10 lines (CLAUDE.md). Hard ceiling per cluster
varies (see table above). Cluster-specific blocks in `eslint.config.mjs`
can tighten the cap but never weaken it.

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

| Error | Command to fix |
|-------|---------------|
| Unused imports | `npm run lint:fix` |
| Prettier formatting | `npm run format` |
| All auto-fixable | `npm run lint:fix` |
| See all errors | `npm run lint` |
| Verify ESLint covers every cluster | `npm run lint:guideline-coverage` |

---

## Pre-commit flow

```
git commit
  → lint-staged runs on changed .ts files only:
      eslint --fix  (auto-fixes unused imports, formatting)
      prettier --write  (normalises style)
  → tsc --noEmit  (type check)
  → guideline-coverage gate  (asserts eslint.config covers CLEAN_CODE.md caps)
  → commit succeeds ✅ or shows remaining errors ❌
```

