# Task: Fix Type Safety Issues in Production Code

## Problem

Production code has `@ts-ignore` comments and inconsistent patterns that bypass TypeScript.

## Issues

### 1. `@ts-ignore` in `getKeyByValue()` (base-scraper-with-browser.ts)

**Location:** `src/scrapers/base-scraper-with-browser.ts:48,63`

```typescript
// @ts-ignore
const conditions = object[key];
// ...
// @ts-ignore
return Promise.resolve(key);
```

**Root cause:** `PossibleLoginResults` type uses `LoginResults` enum keys, but `Object.keys()` returns `string[]`.

**Fix:** Use `Object.entries()` with type assertion:
```typescript
for (const [key, conditions] of Object.entries(object) as [LoginResults, LoginCondition[]][]) {
```

### 2. `@ts-ignore` in `fillInput()` and `setValue()` (elements-interactions.ts)

**Location:** `src/helpers/elements-interactions.ts:44-45,55-56`

```typescript
// @ts-ignore
inputElement.value = '';
```

**Root cause:** `Element` type doesn't have `value` property (only `HTMLInputElement` does).

**Fix:** Cast to `HTMLInputElement`:
```typescript
(input as HTMLInputElement).value = '';
```

### 3. Inconsistent `page.evaluate()` vs `pageEval()` usage

Some scrapers call `page.evaluate()` directly, others use the `pageEval()` helper which adds error handling and readiness checks.

| Scraper | Uses raw `page.evaluate()` | Should use `pageEval()`? |
|---------|---------------------------|-------------------------|
| `hapoalim.ts:118-127` | `getRestContext()` | Yes — add readiness check |
| `union-bank.ts:230-232` | `getAccountNumber()` | Already uses `page.$eval` — OK |
| `leumi.ts:173-175` | Account IDs extraction | Yes |
| `mizrahi.ts:300` | Click dropdown | OK — mutation, not data extraction |

## Acceptance Criteria

- [ ] Zero `@ts-ignore` in production code
- [ ] All `page.evaluate()` for data extraction use `pageEval()` helper
- [ ] TypeScript strict mode passes
- [ ] All tests pass
