# Task: Increase Unit Test Coverage to 100%

## Current State

Coverage baseline (updated Feb 2026 after Phase 2+3 test additions):

- Statements: 31.38%
- Branches: 16.84%
- Functions: 18.59%
- Lines: 31.94%

## Target

100% coverage across all metrics.

## Priority Order

### Priority 1: Helpers (pure/utility functions, easiest to test)

| Module | Current Lines | Strategy |
|--------|:---:|---|
| `src/helpers/dates.ts` | 18% | Pure date math — test all edge cases |
| `src/helpers/transactions.ts` | 18% | Transaction mapping — test transforms |
| `src/helpers/waiting.ts` | 25% | Mock timers, test wait logic |
| `src/helpers/navigation.ts` | 33% | Mock puppeteer Page, test nav helpers |
| `src/helpers/storage.ts` | 20% | Mock fs, test save/load |
| `src/helpers/fetch.ts` | 15% | Mock node-fetch, test retry/error handling |
| `src/helpers/browser.ts` | 25% | Mock puppeteer, test stealth setup |
| `src/helpers/elements-interactions.ts` | 24% | Mock Page/ElementHandle, test interactions |

### Priority 2: Core framework

| Module | Current Lines | Strategy |
|--------|:---:|---|
| `src/scrapers/base-scraper.ts` | 26% | Test lifecycle, progress events, error handling |
| `src/scrapers/base-scraper-with-browser.ts` | 11% | Mock puppeteer.launch, test browser management |
| `src/scrapers/factory.ts` | 56% | Test all company type mappings |
| `src/scrapers/errors.ts` | 77% | Test all error types |

### Priority 3: Scraper implementations

| Module | Current Lines | Strategy |
|--------|:---:|---|
| `src/scrapers/base-isracard-amex.ts` | 11% | Mock page navigation, test parsing |
| `src/scrapers/max.ts` | 32% | Mock API responses, test transaction parsing |
| All other scrapers | 12-30% | Mock page interactions, test data extraction |

## Testing Strategy

### Pure functions (helpers/dates, helpers/transactions)

Direct unit tests with various inputs. No mocking needed.

### Browser interaction code (helpers/browser, helpers/elements-interactions)

Mock `puppeteer.Page` and `puppeteer.ElementHandle`. Test that the correct
selectors are used and values are extracted properly.

### Scraper implementations

Mock the entire page navigation flow. Provide fixture HTML/JSON responses
and verify that transactions are parsed correctly. This avoids real bank
connections while testing parsing logic.

## Ratchet Rule

After adding tests for each module, update `jest.config.js` coverage
thresholds to the new baseline. Thresholds only go up, never down.
