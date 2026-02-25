# Task: Extract Shared Helpers from Duplicated Scraper Code

## Problem

5 scrapers implement nearly identical `getAmountData()` + `getTxnAmount()` functions.
3 scrapers duplicate table extraction logic with identical column-mapping patterns.

## Duplicated Code

### Amount Parsing (5 scrapers)

| File | Functions | Lines |
|------|-----------|-------|
| `src/scrapers/base-beinleumi-group.ts:70-80` | `getAmountData()`, `getTxnAmount()` |
| `src/scrapers/union-bank.ts:47-66` | Same pattern |
| `src/scrapers/yahav.ts:76-85` | Same pattern |
| `src/scrapers/beyahad-bishvilha.ts:33-56` | Variant with currency symbols (₪/$/) |
| `src/scrapers/discount.ts` | Uses `OperationAmount` directly (no credit/debit) |

All follow: strip currency symbol → remove commas → parseFloat → `(credit || 0) - (debit || 0)`

### Table Extraction (3 scrapers)

| File | Pattern |
|------|---------|
| `src/scrapers/base-beinleumi-group.ts:107-157` | `getTransactionDate()`, `getTransactionDescription()`, etc. |
| `src/scrapers/union-bank.ts:97-132` | Identical column-mapping pattern |

Both map table column classes/headers to indices, then extract cell values by index.

## Solution

### 1. Create `src/helpers/amount-parsing.ts`

```typescript
export function parseAmount(amountStr: string): number {
  const cleaned = amountStr.replace(/[₪$€,]/g, '').trim();
  return parseFloat(cleaned);
}

export function calculateCreditDebit(creditStr: string, debitStr: string): number {
  const credit = parseAmount(creditStr);
  const debit = parseAmount(debitStr);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}
```

### 2. Refactor 5 scrapers to use shared helper

Replace inline `getAmountData()` / `getTxnAmount()` with imports from `amount-parsing.ts`.

## Acceptance Criteria

- [ ] `src/helpers/amount-parsing.ts` with `parseAmount()` and `calculateCreditDebit()`
- [ ] Unit tests for the new helper
- [ ] 5 scrapers refactored to use shared helper
- [ ] All existing tests still pass
- [ ] No behavior changes (same inputs → same outputs)
