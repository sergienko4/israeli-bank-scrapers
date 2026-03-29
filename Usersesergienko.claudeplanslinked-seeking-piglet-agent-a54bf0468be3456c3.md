# Fix Amex 0-Transactions: Implementation Plan

## Problem Summary

Amex scraping returns 0 transactions because the Pipeline MatrixLoop never activates. Two bugs prevent it:

1. **Bug 1**: The monthly transactions URL (GetTransactionsList) is not matched by WellKnown API patterns, so discoverTransactionsEndpoint() returns GetLatestTransactions (dashboard preview, 5 txns) instead.
2. **Bug 2**: isMonthlyEndpoint() requires BOTH separate month AND year fields in the POST body. Amex uses a composite date field (billingMonth: '01/04/2026') with no separate year. So isMonthlyEndpoint returns false even for the correct endpoint.

The MatrixLoop (which iterates months to get all transactions) requires BOTH: (a) discovering the correct endpoint, and (b) isMonthlyEndpoint returning true. Both fail today.

## Architecture Understanding

### Call Chain

ScrapePhase.executeScrapePre() clicks transactions link to capture monthly API traffic, then genericAutoScrape() calls buildFetchAllCtx() which calls network.discoverTransactionsEndpoint() [BUG 1: returns wrong endpoint], then fetchAllAccounts() calls fetchOneAccountPost() which calls tryMatrixLoop() which calls isMonthlyEndpoint(postData) [BUG 2: returns false for composite dates] and returns false, falling through to billing fallback which yields 0 txns.

### Key Discovery Mechanism (discoverByWellKnown)

File: src/Scrapers/Pipeline/Mediator/NetworkDiscovery.ts (lines 160-182)

The function iterates patterns IN ORDER, finds the FIRST pattern that matches ANY captured endpoint, then returns that endpoint. Pattern order equals priority.

### Current Transaction Patterns

File: src/Scrapers/Pipeline/Registry/WellKnownApiRegistry.ts (lines 18-24)

Five patterns: transactionsDetails, filteredTransactions, CardsTransactionsList, lastTransactions, GetLatestTransactions. None match GetTransactionsList.

### isMonthlyEndpoint Logic

File: src/Scrapers/Pipeline/Mediator/GenericScrapeReplayStrategy.ts (lines 208-218)

Checks hasMonth (MF.month fields) AND hasYear (MF.year fields). Both must be true. Amex has billingMonth but NO year field.

### Composite Field Detection (already exists)

Same file, lines 167-177: findCompositeField(body) correctly detects composite date fields using MF.compositeDate. It is used by buildMonthBody but NOT by isMonthlyEndpoint.

---

## Implementation Steps

### Step 1: Fix isMonthlyEndpoint (Bug 2 -- highest impact)

**File**: src/Scrapers/Pipeline/Mediator/GenericScrapeReplayStrategy.ts
**Lines**: 208-218

Add a fallback check: after the existing hasMonth && hasYear check, also return true if findCompositeField(body) is not false.

The change replaces line 214 (return hasMonth && hasYear) with:

    if (hasMonth && hasYear) return true;
    // Composite date field (e.g. '01/04/2026') contains both month and year
    return findCompositeField(body) !== false;

**Why safe**: findCompositeField already exists at line 167, is already called by buildMonthBody (line 189), and uses the same WK MF.compositeDate registry. No new logic -- just calling an existing function from one more place. If findCompositeField returns false for Discount/VisaCal (they use separate month+year), the existing hasMonth && hasYear path returns true first. The new path is only reached when the existing check fails.

### Step 2: Add WK Pattern for GetTransactionsList (Bug 1)

**File**: src/Scrapers/Pipeline/Registry/WellKnownApiRegistry.ts
**Lines**: 18-24

Add /GetTransactionsList/i to the transactions array, BEFORE /GetLatestTransactions/i.

**Critical ordering rationale**: discoverByWellKnown returns the first pattern match. For Amex, both GetLatestTransactions and GetTransactionsList exist in traffic. If GetLatestTransactions is checked first, it matches and returns the dashboard preview endpoint (wrong). By putting GetTransactionsList before GetLatestTransactions, the monthly-capable endpoint is discovered when both exist. When only GetLatestTransactions exists (other banks), the GetTransactionsList pattern does not match any traffic, so GetLatestTransactions is tried next -- correct behavior.

Final pattern order:
- /transactionsDetails/i
- /filteredTransactions/i
- /CardsTransactionsList/i
- /lastTransactions/i
- /GetTransactionsList/i   (NEW -- monthly-capable, checked before dashboard preview)
- /GetLatestTransactions/i (existing -- dashboard preview fallback)

### Step 3: Optional trace logging in ScrapePhase PRE

**File**: src/Scrapers/Pipeline/Phases/ScrapePhase.ts
**Lines**: 328-336

Add LOG.debug calls before resolveAndClick and after waitForNetworkIdle for diagnostic visibility during E2E validation. This is temporary and low-risk.

---

## Regression Analysis

**Discount bank**: Uses transactionsDetails pattern, first in array, unaffected. Uses separate month+year fields, existing hasMonth && hasYear returns true, new composite path never reached.

**VisaCal**: Uses CardsTransactionsList pattern, third in array, unaffected. Uses separate month+year fields, same reasoning.

**Other banks**: The new pattern only matches URLs containing GetTransactionsList. The composite date fallback only activates when separate month+year fields are absent. No existing bank behavior changes.

## Verification Plan

1. npm run build -- must exit 0
2. npm test -- must pass all existing tests
3. E2E Discount -- must get about 48 txns (regression check)
4. E2E VisaCal -- must get about 76 txns (regression check)
5. E2E Amex -- must get more than 20 txns (the goal)

Run E2E tests one at a time, sequentially.

## File Change Summary

| File | Change | Scope |
|------|--------|-------|
| GenericScrapeReplayStrategy.ts | Add composite date fallback to isMonthlyEndpoint | 2 lines inserted |
| WellKnownApiRegistry.ts | Add GetTransactionsList pattern, reorder before GetLatestTransactions | 1 line inserted |
| ScrapePhase.ts | Add diagnostic LOG.debug calls (optional, temporary) | 2 lines inserted |
