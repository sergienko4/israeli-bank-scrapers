# 🛠️ Clean Code Guide

This project enforces quality limits automatically on every commit.
When ESLint blocks your commit, find your error below and apply the fix.

---

## 1. Function too long (`max-lines-per-function`)

**Rule:** Hard limit = 20 lines. Ideal = 10 lines (see CLAUDE.md).

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

## 5. Unused imports (`unused-imports/no-unused-imports`)

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

---

## Pre-commit flow

```
git commit
  → lint-staged runs on changed .ts files only:
      eslint --fix  (auto-fixes unused imports, formatting)
      prettier --write  (normalises style)
  → tsc --noEmit  (type check)
  → commit succeeds ✅ or shows remaining errors ❌
```
