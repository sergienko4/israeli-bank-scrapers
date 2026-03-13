# Task: Migrate $eval/$$eval to Playwright Locator API

## Status: Done

## Priority: Medium

## Estimated effort: 4-6h

## Context

`$eval` and `$$eval` are Puppeteer-era patterns. Playwright best practice is the Locator API which auto-waits, auto-retries, and is more resilient to DOM changes.

~21 `$eval`/`$$eval` calls across production code, primarily in:
- Beinleumi group (DOM scraping — reads HTML tables)
- Mizrahi (click helpers)
- Yahav (account ID, text extraction)
- Leumi (login config)
- Max (login config)
- Common/ElementsInteractions.ts (clickButton, clickLink, pageEval, pageEvalAll)
- Common/SelectorLabelStrategies.ts (tag/type detection)

## Migration Map

| Old (Puppeteer-era) | New (Playwright Locator) |
|-----|-----|
| `page.$eval(sel, el => el.innerText)` | `page.locator(sel).innerText()` |
| `page.$$eval(sel, els => els.map(...))` | `page.locator(sel).evaluateAll(...)` or `.allInnerTexts()` |
| `page.$eval(sel, el => el.click())` | `page.locator(sel).click()` |
| `page.$eval(sel, el => el.href)` | `page.locator(sel).getAttribute('href')` |
| `page.$eval(sel, el => el.textContent)` | `page.locator(sel).textContent()` |

## Priority Order

1. **Common/ElementsInteractions.ts** — used by all scrapers (clickButton, clickLink, pageEval, pageEvalAll)
2. **Beinleumi group** — heaviest $eval user (table scraping)
3. **Mizrahi** — click helpers
4. **Yahav, Leumi, Max** — login configs

## Acceptance Criteria

- [x] Zero `$eval` / `$$eval` calls in production code
- [x] All existing tests pass
- [ ] E2E mocked + real tests pass (awaiting OTP for Beinleumi)
- [x] No behavior changes — same data extracted
- [x] ESLint, TypeScript, Prettier clean
