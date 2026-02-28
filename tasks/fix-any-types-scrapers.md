# Task: Fix `any` Types in Scraper Production Code

## Priority: Medium | Effort: Medium (half day)

## Current State

Multiple scraper files use `any` types that weaken type safety:

| File | Lines | Issue |
|------|-------|-------|
| mizrahi.ts | 31-36 | 6 interface fields typed `any` (ScrapedTransaction) |
| leumi.ts | 63 | `transactions: any[]` parameter |
| leumi.ts | 140 | `responseJson: any` |
| leumi.ts | 204 | `element as any` |
| visa-cal.ts | 125 | `choiceExternalTransactions: any` |
| visa-cal.ts | 182, 186 | `isAuthModule(result: any)`, `authModuleOrUndefined(result: any)` |
| hapoalim.ts | 19 | `bnhpApp: any` |

## Target

Replace `any` with proper types or `unknown` + type guards.

## Planned Work

### 1. mizrahi.ts — type ScrapedTransaction fields from actual API response
### 2. leumi.ts — type transaction arrays and response objects
### 3. visa-cal.ts — type auth module responses
### 4. hapoalim.ts — type window.bnhpApp

## Acceptance Criteria

- [ ] Zero `any` in production scraper files (test files excluded)
- [ ] All existing tests pass
- [ ] `npm run type-check` clean with strict mode
