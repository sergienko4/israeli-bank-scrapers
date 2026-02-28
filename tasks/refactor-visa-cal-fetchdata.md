# Task: Refactor visa-cal.ts fetchData (50 lines → <10 each)

## Priority: Medium | Effort: Medium (half day)

## Current State

`fetchData()` in `visa-cal.ts` is 50 logic lines — the largest method in the codebase.
It mixes: date computation, card/auth fetching, frames fetching, per-card monthly loop,
validation, transaction conversion, and date filtering.

## Target

Break into 5-6 focused methods, each under 10 lines.

## Planned Work

### 1. Extract `fetchCardsAndAuth()` — fetches cards, xSiteId, auth header
### 2. Extract `fetchCardTransactions(card, months)` — monthly loop + pending
### 3. Extract `convertAndFilterTransactions(raw, startDate)` — conversion + date filter
### 4. Keep `fetchData()` as orchestrator calling these 3

## Acceptance Criteria

- [ ] No method over 10 logic lines
- [ ] Same behavior — all existing tests pass
- [ ] `npm run type-check` clean
- [ ] `npm run lint` clean
- [ ] E2E mocked tests pass (amex/isracard share base class)
