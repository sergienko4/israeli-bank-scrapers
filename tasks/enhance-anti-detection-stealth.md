# Task: Enhance Anti-Detection with puppeteer-extra-plugin-stealth

## Priority: High | Effort: Medium (half day)

## Current State

Custom anti-detection in `src/helpers/browser.ts` covers 8 techniques:
- `navigator.webdriver` = undefined
- Dynamic Chrome User-Agent
- Client hints headers (sec-ch-ua)
- Hebrew locale (navigator.languages)
- window.chrome mock
- navigator.permissions override
- navigator.plugins mock (dummy array)
- Bot detection script blocking (base-isracard-amex.ts)

**Bypass rate: ~85% vs Israeli banks, ~20% vs modern WAFs (Cloudflare/Akamai)**

**Missing:** CDP flag suppression, WebGL/Canvas spoofing, realistic plugins, screen metrics,
iframe prototype chain, hardwareConcurrency, behavioral delays, request rate randomization.

## Target

- Replace custom stealth code with `puppeteer-extra-plugin-stealth` (20+ evasion modules)
- Keep bank-specific customizations (Hebrew locale, bot script blocking, rate limiting)
- Add human-like behavioral delays between actions
- Add request rate randomization
- **Target bypass rate: 95%+ vs Israeli banks, 40%+ vs modern WAFs**

## Planned Work

### 1. Install puppeteer-extra + stealth plugin

```bash
npm install puppeteer-extra puppeteer-extra-plugin-stealth
```

- `puppeteer-extra` wraps puppeteer with plugin support
- `puppeteer-extra-plugin-stealth` applies 20+ evasion techniques automatically

### 2. Update browser launch in base-scraper-with-browser.ts

Replace `puppeteer.launch()` with stealth-wrapped launch:

```typescript
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());
```

The stealth plugin auto-applies on every `puppeteer.launch()` call.

### 3. Simplify src/helpers/browser.ts

Remove techniques now handled by stealth plugin:
- `applyStealthScript()` — replaced by stealth plugin's evasions
- `setRealisticUserAgent()` — keep (bank-specific Hebrew UA)
- `setRealisticHeaders()` — keep (bank-specific client hints)
- `isBotDetectionScript()` — keep (bank-specific script blocking)

Keep bank-specific customizations:
- Hebrew locale override (stealth defaults to English)
- Custom client hints headers for Israeli banks
- Bot detection script URL patterns

### 4. Add human-like behavioral delays

Create `src/helpers/human-behavior.ts`:
- `humanDelay(min?, max?)` — random delay between actions (500-2500ms)
- `humanTypeDelay()` — per-keystroke delay (50-150ms)
- Apply delays in `fillInputs()` and before `clickButton()`

### 5. Add request rate randomization

Update `src/helpers/fetch.ts`:
- Add configurable delay between consecutive fetch calls (100-500ms)
- Exponential backoff on 429 responses

### 6. Update tests

- Update `src/helpers/browser.test.ts` — adjust for new stealth plugin API
- Update `src/tests/e2e-mocked/anti-detection.e2e-mocked.test.ts` — verify stealth evasions
- Update mock setup in scraper tests that mock `puppeteer`

## Implementation Approach

### Files to modify
- `package.json` — add puppeteer-extra, puppeteer-extra-plugin-stealth
- `src/helpers/browser.ts` — simplify, delegate to stealth plugin
- `src/helpers/human-behavior.ts` — NEW: behavioral delay utilities
- `src/helpers/fetch.ts` — add rate randomization
- `src/scrapers/base-scraper-with-browser.ts` — use puppeteer-extra for launch
- `src/helpers/elements-interactions.ts` — add delays to fillInput/clickButton
- Test files — update puppeteer mocks

### Key constraint
- `puppeteer-extra` is a **production dependency** (not dev) — it wraps puppeteer at runtime
- The stealth plugin applies transparently — no API changes for scrapers
- Users who pass `browser` or `browserContext` in options still work (stealth only applies to our launches)

### Test strategy
- Unit tests: mock puppeteer-extra same way we mock puppeteer
- E2E mocked: verify stealth evasions are applied (webdriver, UA, chrome object)
- E2E real: run against Amex/VisaCal to verify no regressions

## Acceptance Criteria

- [ ] `puppeteer-extra` and `puppeteer-extra-plugin-stealth` installed
- [ ] Stealth plugin applied to all browser launches
- [ ] Custom Hebrew locale + client hints preserved on top of stealth
- [ ] Bot detection script blocking preserved
- [ ] Human-like delays added to form interactions
- [ ] Request rate randomization in fetch helpers
- [ ] All 384 unit tests pass
- [ ] E2E mocked tests pass (anti-detection verification)
- [ ] E2E real tests pass (Amex, VisaCal)
- [ ] ESLint, TypeScript, Prettier clean
- [ ] npm audit: 0 vulnerabilities
