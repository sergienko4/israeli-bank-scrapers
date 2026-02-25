# Task: Break Down Long Methods (>10 Lines)

## Problem

CLAUDE.md rule: "Max 10 lines per method — extract helpers". Multiple scrapers violate this severely.

## Violations

### Critical (>40 lines)

| File | Method | Lines | What it does |
|------|--------|-------|-------------|
| `src/scrapers/visa-cal.ts:446-550` | `fetchData()` | 105 | Card fetch, auth, month loop, pending, filter, return |
| `src/scrapers/visa-cal.ts:281-340` | `convertParsedDataToTransactions()` | 60 | Pending merge, amount calc, installments, date, status |
| `src/scrapers/mizrahi.ts:343-400` | `fetchAccount()` | 58 | Navigation, API intercept, txn fetch, pending, filter |
| `src/scrapers/base-isracard-amex.ts:178-217` | Transaction mapping | 40 | Amount, date, installments, currency, identifier |
| `src/scrapers/leumi.ts:114-160` | `fetchTransactionsForAccount()` | 47 | Delay, filter, API call, parse, split pending/completed |
| `src/scrapers/base-beinleumi-group.ts:323-334` | `fetchAccountData()` | OK but callers are long |

### Approach per method

**visa-cal `fetchData()`** — Extract:
- `fetchCardsAndAuth()` — get cards, xSiteId, authorization
- `fetchCardTransactions(card)` — pending + monthly loop
- `processTransactions(allData, pendingData)` — convert + filter

**visa-cal `convertParsedDataToTransactions()`** — Extract:
- `getTransactionAmounts(txn)` — chargedAmount, originalAmount
- `getTransactionInstallments(txn)` — installments info
- `mapSingleTransaction(txn)` — combine all fields

**mizrahi `fetchAccount()`** — Extract:
- `navigateToTransactionPage()` — click links, wait for elements
- `fetchTransactionApiResponse()` — Promise.any + request intercept
- `processAccountTransactions(response)` — filter, convert, merge pending

**leumi `fetchTransactionsForAccount()`** — Extract:
- `waitAndFilterTransactions()` — delay, filter setup
- `parseTransactionResponse(response)` — JSON parse, split pending/completed

## Acceptance Criteria

- [ ] No method >10 lines in modified files
- [ ] All existing tests pass
- [ ] No behavior changes
- [ ] ESLint, TypeScript, Prettier clean
