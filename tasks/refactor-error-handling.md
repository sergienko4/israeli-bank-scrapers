# Task: Standardize Error Handling Across Scrapers

## Problem

Each scraper handles errors differently — some wrap in try-catch, some return raw errors, some throw. This makes error behavior unpredictable for callers.

## Current Patterns

| Scraper | Pattern | Issue |
|---------|---------|-------|
| `mizrahi.ts:304-326` | try-catch wraps entire loop, returns `ScraperErrorTypes.Generic` | Catches everything, loses specificity |
| `discount.ts:105-111` | Returns error result inline with `errorMessage` | Good pattern |
| `base-beinleumi-group.ts:484-501` | No error wrapping | Throws raw errors to base class |
| `leumi.ts:179-181` | Throws `new Error()` directly | Base class catches as Generic |
| `visa-cal.ts:505-511` | Throws on statusCode check | Base class catches |
| `one-zero.ts:324` | Returns `createGenericError()` | Good — uses error factory |

## Target Pattern

Use `createGenericError()` from `src/scrapers/errors.ts` consistently:

```typescript
// GOOD: Use error factories
if (!response) return createGenericError('Failed to fetch data');

// BAD: Throw raw errors
if (!response) throw new Error('Failed to fetch data');

// BAD: Inline error objects
if (!response) return { success: false, errorType: ScraperErrorTypes.Generic, errorMessage: '...' };
```

## Acceptance Criteria

- [ ] All scrapers use `createGenericError()` or `createTimeoutError()` for error returns
- [ ] No raw `throw new Error()` in `fetchData()` methods (let base class handle)
- [ ] Consistent error messages (Hebrew or English, not mixed)
- [ ] All tests pass
