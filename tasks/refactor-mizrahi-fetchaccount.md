# Task: Refactor mizrahi.ts fetchAccount (35 lines → <10 each)

## Priority: Medium | Effort: Medium (half day)

## Current State

`fetchAccount()` in `mizrahi.ts` is 35 logic lines — chains 9 sequential operations:
navigate to OSH page, navigate to transactions, extract account number, race two request URLs,
validate response, convert transactions, mark pending, filter by date, fetch pending.

Also: `Promise.any()` swallows `AggregateError`, losing inner error details.

## Target

Break into focused methods. Fix `AggregateError` handling.

## Planned Work

### 1. Extract `navigateToTransactions()` — 4 sequential click/wait operations
### 2. Extract `captureTransactionRequest()` — Promise.any with proper error handling
### 3. Extract `processTransactions(data, startDate, options)` — convert + pending + filter
### 4. Keep `fetchAccount()` as orchestrator

## Acceptance Criteria

- [ ] No method over 10 logic lines
- [ ] `AggregateError` properly logged/handled
- [ ] All existing tests pass
- [ ] `npm run type-check` + `npm run lint` clean
