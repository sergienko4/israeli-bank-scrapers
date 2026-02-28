# Task: Refactor Leumi Scraper — DOM Parsing to API Interception

## Priority: Medium | Effort: Large (1 day)

## Current State

Leumi scraper parses HTML DOM for transaction data. But the bank's SPA makes
internal API calls that return JSON. We can intercept those responses via
`page.on('response')` or `page.waitForResponse()` instead of parsing DOM.

The scraper already uses `page.waitForResponse()` for one call (line 137).
The transaction data could be captured the same way.

Also: duplicated `hangProcess(4000)` at lines 122 and 171.

## Target

Replace DOM parsing with API response interception where possible.
Remove duplicated delays. More resilient to UI changes.

## Planned Work

### 1. Identify all internal API endpoints Leumi's SPA calls
### 2. Replace DOM-based transaction extraction with response interception
### 3. Remove duplicated `hangProcess(4000)` calls
### 4. Break `fetchTransactionsForAccount()` (28 lines) into focused methods

## Acceptance Criteria

- [ ] Transaction data from API responses, not DOM parsing
- [ ] No duplicated `hangProcess` calls
- [ ] All methods under 10 lines
- [ ] E2E invalid-login test still passes
- [ ] Mocked E2E test updated if needed
