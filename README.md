<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![npm version][npm-shield]][npm-url]
[![CI][ci-shield]][ci-url]
[![MIT License][license-shield]][license-url]
[![Docs][docs-shield]][docs-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/sergienko4/israeli-bank-scrapers">
    <img src="./logo.png" alt="Logo" width="120" height="120">
  </a>

  <h3 align="center">Israeli Bank Scrapers (Fork)</h3>

  <p align="center">
    Scrape transactions from all 18 Israeli banks with <strong>Cloudflare WAF bypass</strong>
    <br />
    <code>npm install @sergienko4/israeli-bank-scrapers</code>
    <br />
    <br />
    <a href="https://www.npmjs.com/package/@sergienko4/israeli-bank-scrapers">npm</a>
    &middot;
    <a href="https://sergienko4.github.io/israeli-bank-scrapers/">API Docs</a>
    &middot;
    <a href="https://github.com/sergienko4/israeli-bank-scrapers/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/sergienko4/israeli-bank-scrapers/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about">About</a></li>
    <li><a href="#supported-institutions">Supported Institutions</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#upgrading">Upgrading</a></li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#type-reference">Type Reference</a></li>
    <li><a href="#waf-troubleshooting">WAF Troubleshooting</a></li>
    <li><a href="#advanced-options">Advanced Options</a></li>
    <li><a href="#architecture">Architecture</a></li>
    <li><a href="#performance-tips">Performance Tips</a></li>
    <li><a href="#version-timeline">Version Timeline</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#known-projects">Known Projects</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

---

## About

**Maintained fork** of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) with **Camoufox** (Firefox anti-detect browser with C++-level stealth) — bypasses Cloudflare Bot Management, the main blocker for Amex and Isracard scraping since early 2026.

### What's different from upstream?

| Feature               | Upstream (Puppeteer)                 | This Fork (Camoufox + Playwright)                                     |
| --------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| Browser engine        | Puppeteer (CDP fingerprint detected) | Camoufox — Firefox anti-detect with C++-level stealth                 |
| Cloudflare WAF bypass | No                                   | First-attempt pass — native anti-detect, no plugins needed            |
| Module format         | CommonJS only                        | Full ESM (`"type": "module"`) with dual CJS/ESM output                |
| WAF error reporting   | "Unknown error"                      | Structured `WAF_BLOCKED` with provider, HTTP status, suggestions      |
| Login field detection | Hardcoded CSS selectors              | WellKnown system — finds fields by visible text, label, placeholder   |
| OTP auto-detection    | Manual                               | Automatic — detects OTP screen, fills code, no browser changes needed |
| Architecture          | Per-bank scrapers                    | Login middleware chain with HTML parser + cached frame resolution     |
| TypeScript            | 4.7                                  | 5.9 strict mode, JSDoc on all functions                               |
| Type naming           | No prefix                            | I-prefix interfaces (v8.0+), backward-compat aliases included        |
| Test coverage         | ~600 tests                           | 895 tests, 68 suites, coverage thresholds enforced                    |
| E2E coverage          | 3 banks                              | All 18 institutions                                                   |

### What's new in v8.0.0

- **Strict ESLint with JSDoc** — every function, method, and class has JSDoc documentation. 2,598 ESLint errors resolved.
- **I-prefix interfaces** — all public interfaces renamed with `I` prefix (e.g., `IScraper`, `IScraperScrapingResult`). **Backward-compatible**: old names (`Scraper`, `ScraperLoginResult`, `ScraperScrapingResult`) still work as type aliases.
- **256 new tests** — total: 895 tests across 68 suites with enforced coverage thresholds.
- **Architectural bans** — ESLint rules enforce: no `any`, no `void` returns, no `sleep()`/`setTimeout()`, no nested function calls, max 20 lines per function.

Camoufox integration, middleware architecture, and ESM migration by [@sergienko4](https://github.com/sergienko4). Validated on all 18 institutions across local, Azure, and Oracle Cloud servers.

### Built With

[![npm][npm-shield]][npm-url] [![TypeScript][ts-shield]][ts-url] [![Node.js][node-shield]][node-url] [![Camoufox][camoufox-shield]][camoufox-url] [![Playwright][pw-shield]][pw-url] [![Jest][jest-shield]][jest-url] [![ESLint][eslint-shield]][eslint-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Supported Institutions

<details>
  <summary>All 18 Israeli banks and credit card companies:</summary>
  <ol>

| Institution        | Type        | Credentials                           | Contributors                                                                           |
| ------------------ | ----------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| Bank Hapoalim      | Bank        | `userCode`, `password`                | [@sebikaplun](https://github.com/sebikaplun)                                           |
| Bank Leumi         | Bank        | `username`, `password`                | [@esakal](https://github.com/esakal)                                                   |
| Discount Bank      | Bank        | `id`, `password`, `num`               |                                                                                        |
| Mercantile Bank    | Bank        | `id`, `password`, `num`               | [@ezzatq](https://github.com/ezzatq), [@kfirarad](https://github.com/kfirarad)         |
| Mizrahi Tefahot    | Bank        | `username`, `password`                | [@baruchiro](https://github.com/baruchiro)                                             |
| Bank Otsar Hahayal | Bank        | `username`, `password`                | [@matanelgabsi](https://github.com/matanelgabsi)                                       |
| Union Bank         | Bank        | `username`, `password`                | [@dratler](https://github.com/dratler), [@dudiventura](https://github.com/dudiventura) |
| Bank Yahav         | Bank        | `username`, `nationalID`, `password`  | [@gczobel](https://github.com/gczobel)                                                 |
| Bank Massad        | Bank        | `username`, `password`                |                                                                                        |
| Pagi Bank          | Bank        | `username`, `password`                |                                                                                        |
| One Zero           | Bank        | `email`, `password`, OTP              | [@orzarchi](https://github.com/orzarchi), [@sergienko4](https://github.com/sergienko4) |
| Beinleumi          | Bank        | `username`, `password`, OTP           | [@sergienko4](https://github.com/sergienko4)                                           |
| Beyahad Bishvilha  | Bank        | `id`, `password`                      | [@esakal](https://github.com/esakal)                                                   |
| Behatsdaa          | Bank        | `id`, `password`                      | [@daniel-hauser](https://github.com/daniel-hauser)                                     |
| Amex               | Credit Card | `id`, `card6Digits`, `password`       | [@erezd](https://github.com/erezd), [@sergienko4](https://github.com/sergienko4)       |
| Isracard           | Credit Card | `id`, `card6Digits`, `password`       | [@sergienko4](https://github.com/sergienko4)                                           |
| Visa Cal           | Credit Card | `username`, `password`                | [@erikash](https://github.com/erikash), [@esakal](https://github.com/esakal)           |
| Max                | Credit Card | `username`, `password`, `id` (Flow B) | [@sergienko4](https://github.com/sergienko4)                                           |

 </ol>
</details>
<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) >= 22.14.0

### Installation

```sh
npm install @sergienko4/israeli-bank-scrapers
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Upgrading

### From upstream (eshaham/israeli-bank-scrapers)

```diff
- npm install israeli-bank-scrapers
+ npm install @sergienko4/israeli-bank-scrapers
```

```diff
- import { createScraper } from 'israeli-bank-scrapers';
+ import { createScraper } from '@sergienko4/israeli-bank-scrapers';
```

Key differences:
- **Browser**: Playwright + Camoufox instead of Puppeteer. If you pass your own `browser`, use `Camoufox()` instead of `chromium.launch()`
- **`getPuppeteerConfig()`**: Removed. Use Playwright's API directly
- **Module format**: Full ESM with dual CJS/ESM output. Both `import` and `require()` work
- **Type names**: Interfaces use `I` prefix (e.g., `IScraper`). Old names still work as aliases

### v7.x → v8.0.0

**Type renames (non-breaking with aliases):**

All public interfaces now use the `I` prefix. Old names are re-exported as type aliases and continue to work:

```typescript
// Both work — old names are aliases for the new I-prefixed types
import type { Scraper } from '@sergienko4/israeli-bank-scrapers';              // v7 name (still works)
import type { IScraper } from '@sergienko4/israeli-bank-scrapers';             // v8 name (preferred)

import type { ScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers'; // v7 name (still works)
import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers'; // v8 name (preferred)
```

| v7.x name | v8.0.0 name | Status |
|---|---|---|
| `Scraper<T>` | `IScraper<T>` | Alias works |
| `ScraperLoginResult` | `IScraperLoginResult` | Alias works |
| `ScraperScrapingResult` | `IScraperScrapingResult` | Alias works |
| `ScraperCredentials` | `ScraperCredentials` | Unchanged |
| `ScraperOptions` | `ScraperOptions` | Unchanged |

**No code changes required** — your existing imports continue to work. The new `I`-prefixed names are recommended for new code.

### v7.8.x → v7.9.x

**Browser engine change (non-breaking for consumers):**

- `playwright-extra` + `puppeteer-extra-plugin-stealth` replaced by `@hieutran094/camoufox-js` (Firefox anti-detect browser)
- The scraper API is unchanged — `createScraper()` works identically
- If you pass your own `browser` instance, use `Camoufox()` instead of `chromium.launch()`

### v7.9.x → v7.10.x

**Full ESM migration (potentially breaking for test consumers):**

- `package.json` now has `"type": "module"`
- Dual CJS/ESM output: `lib/index.mjs` (ESM) + `lib/index.cjs` (CJS)
- If you import this library, `import` and `require()` both work — no changes needed
- If you extend scraper classes in tests: `jest` is no longer a global in ESM — use `import { jest } from '@jest/globals'`

### v7.0.x → v7.1.x

**New additions (non-breaking):**

- `ScraperOptions.otpCodeRetriever` — optional callback for DOM banks (Beinleumi, Discount). Not required — if omitted and OTP is detected, returns `TWO_FACTOR_RETRIEVER_MISSING`.
- `ScraperScrapingResult.persistentOtpToken` — optional token returned by banks supporting session reuse (e.g. OneZero). Save and pass as `credentials.otpLongTermToken` to skip SMS on next run.
- `ScraperErrorTypes.InvalidOtp = 'INVALID_OTP'` — new error type when OTP code is rejected.

**Deprecated (still works, no action needed):**

- `ScraperErrorTypes.General = 'GENERAL_ERROR'` — use `ScraperErrorTypes.Generic = 'GENERIC'` instead. Both values remain in the enum.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.amex,
  startDate: new Date('2024-01-01'),
  shouldCombineInstallments: false,
});

const result = await scraper.scrape({
  id: '123456789',
  card6Digits: '123456',
  password: 'mypassword',
});

if (result.success) {
  for (const account of result.accounts!) {
    console.log(`${account.accountNumber}: ${account.txns.length} transactions`);
  }
} else {
  console.error(result.errorType, result.errorMessage);
  if (result.errorDetails) {
    console.error('Provider:', result.errorDetails.provider);
    console.error('Suggestions:', result.errorDetails.suggestions);
  }
}
```

All scrapers support up to one year of transaction history. See credentials per institution in the [Supported Institutions](#supported-institutions) table.

### Result Structure

```typescript
{
  success: boolean;
  persistentOtpToken?: string;  // save to reuse on next run (bank-dependent expiry)
  accounts?: [{
    accountNumber: string;
    balance?: number;           // real-time balance including pending transactions
    txns: [{
      type: 'normal' | 'installments';
      identifier?: number;
      date: string;          // ISO date
      processedDate: string; // ISO date
      originalAmount: number;
      originalCurrency: string;
      chargedAmount: number;
      description: string;
      memo?: string;
      installments?: { number: number; total: number };
      status: 'completed' | 'pending';
    }];
  }];
  // On failure:
  errorType?: 'INVALID_OTP'        // wrong/expired OTP code — ask user to retry
            | 'TWO_FACTOR_RETRIEVER_MISSING' // OTP required but otpCodeRetriever not set
            | 'INVALID_PASSWORD' | 'CHANGE_PASSWORD' | 'ACCOUNT_BLOCKED'
            | 'TIMEOUT' | 'GENERIC' | 'WAF_BLOCKED'
            | 'GENERAL_ERROR';     // @deprecated — same as GENERIC, kept for backwards compatibility
  errorMessage?: string;
  errorDetails?: {          // Only on WAF_BLOCKED
    provider: 'cloudflare' | 'unknown';
    httpStatus: number;
    pageTitle: string;
    pageUrl: string;
    responseSnippet?: string;
    suggestions: string[];  // Actionable fix suggestions
  };
}
```

### Scraper Metadata

```typescript
import { SCRAPERS } from '@sergienko4/israeli-bank-scrapers';
// Returns: { [companyId]: { name: string, loginFields: string[] } }
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Type Reference

All types are exported from the package entry point:

```typescript
import type {
  IScraper,                // Main scraper interface (generic over credentials)
  IScraperScrapingResult,  // Result of scrape() — accounts, errors, diagnostics
  IScraperLoginResult,     // Login attempt result
  ScraperCredentials,      // Union of all credential shapes
  ScraperOptions,          // Configuration passed to createScraper()
} from '@sergienko4/israeli-bank-scrapers';
```

### Exported Types

| Type | Description |
|---|---|
| `IScraper<TCredentials>` | Main scraper interface with `scrape()`, `onProgress()`, `triggerTwoFactorAuth()` |
| `IScraperScrapingResult` | Result object: `success`, `accounts`, `errorType`, `errorDetails`, `diagnostics` |
| `IScraperLoginResult` | Login result: `success`, `errorType`, `errorMessage` |
| `ScraperCredentials` | Union type for all bank credential shapes |
| `ScraperOptions` | Config: `companyId`, `startDate`, browser options, OTP, timeouts |
| `CompanyTypes` | Enum of all supported bank/card company identifiers |
| `SCRAPERS` | Object with metadata (name, loginFields) for each company |

### Backward-Compatible Aliases

These v7.x names are re-exported as type aliases and continue to work:

| v7.x name | Points to | Usage |
|---|---|---|
| `Scraper<T>` | `IScraper<T>` | `import type { Scraper } from '...'` |
| `ScraperLoginResult` | `IScraperLoginResult` | `import type { ScraperLoginResult } from '...'` |
| `ScraperScrapingResult` | `IScraperScrapingResult` | `import type { ScraperScrapingResult } from '...'` |
| `ScaperLoginResult` | `IScraperLoginResult` | Legacy typo alias (upstream compat) |
| `ScaperScrapingResult` | `IScraperScrapingResult` | Legacy typo alias (upstream compat) |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## WAF Troubleshooting

Camoufox bypasses most Cloudflare challenges automatically via C++-level Firefox anti-detect. If you still get `errorType: 'WAF_BLOCKED'`:

| Scenario            | What happens                         | Fix                                     |
| ------------------- | ------------------------------------ | --------------------------------------- |
| API-level 403       | Login succeeds but API calls blocked | Wait 1-2 hours, reduce scrape frequency |
| Datacenter IP block | Cloud provider IPs rate-limited      | Use residential proxy or Azure          |
| Turnstile CAPTCHA   | Interactive challenge on login page  | Use a trusted IP provider               |
| First run on new IP | Cloudflare flags unknown IP          | Run once with `headless: false` to pass initial challenge, then switch to headless |
| Parallel scraping   | Too many concurrent requests         | Use browser contexts (shared browser), add 2-5s delay between scrapers |

> **Tip:** Camoufox passes WAF on first attempt from most IPs. No stealth plugins or retry logic needed — anti-detection is built into the browser binary.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Advanced Options

### External Browser

Pass your own Camoufox browser instance (launched via Playwright's `firefox.launch` with the Camoufox binary):

```typescript
import { Camoufox } from '@hieutran094/camoufox-js';

const browser = await Camoufox({ headless: true });
const scraper = createScraper({
  companyId: CompanyTypes.leumi,
  startDate: new Date('2024-01-01'),
  browser,
  skipCloseBrowser: true,
});
const result = await scraper.scrape(credentials);
await browser.close();
```

### Browser Context

Use isolated browser contexts for parallel scraping:

```typescript
const browser = await Camoufox({ headless: true });
const browserContext = await browser.newContext();
const scraper = createScraper({
  companyId: CompanyTypes.leumi,
  startDate: new Date('2024-01-01'),
  browserContext,
});
```

### Two-Factor Authentication

Several banks require OTP (one-time password / SMS code). The OTP flow differs by bank type:

**Banks that require OTP:**

| Bank                                             | Type     | How                                   |
| ------------------------------------------------ | -------- | ------------------------------------- |
| Beinleumi (+ group: Massad, Otsar Hahayal, Pagi) | SMS code | `otpCodeRetriever` in scraper options |
| Discount                                         | SMS code | `otpCodeRetriever` in scraper options |
| One Zero                                         | SMS code | `otpCodeRetriever` in credentials     |

**DOM banks** (browser-based: Beinleumi, Discount, …) — pass `otpCodeRetriever` in scraper options:

```typescript
const scraper = createScraper({
  companyId: CompanyTypes.beinleumi,
  startDate,
  otpCodeRetriever: async phoneHint => {
    console.log(`SMS sent to ${phoneHint}. Enter code:`);
    return await readCodeFromSomewhere(); // e.g. stdin, file, push notification
  },
});
const result = await scraper.scrape({ username, password });
```

**API banks** (no browser: OneZero) — pass `otpCodeRetriever` **in credentials**:

```typescript
const result = await scraper.scrape({
  email: 'user@example.com',
  password: 'pass',
  phoneNumber: '+972...',
  otpCodeRetriever: async () => '123456', // Return OTP from SMS
});
// result.persistentOtpToken — save to skip SMS on next run (valid ~1 hour for OneZero)
```

**Reuse a previous OTP token** (skips SMS entirely):

```typescript
const result = await scraper.scrape({
  email: 'user@example.com',
  password: 'pass',
  otpLongTermToken: process.env.ONEZERO_OTP_TOKEN,
});
```

**Error handling:**

```typescript
if (!result.success && result.errorType === 'INVALID_OTP') {
  // Wrong or expired OTP code — ask user to try again
}
if (!result.success && result.errorType === 'TWO_FACTOR_RETRIEVER_MISSING') {
  // Bank requires OTP but no otpCodeRetriever was provided
}
```

### Opt-In Features

Some scrapers support opt-in features for breaking changes. See the [OptInFeatures type](./src/Scrapers/Base/Interface.ts).

---

## Architecture

### Login Middleware Chain

The login flow uses a middleware pattern — each step receives a shared `LoginContext` and can stop the chain or pass results to the next step:

```
stepNavigate → stepParseLoginPage → stepFillAndSubmit → stepCheckResult → stepOtpConfirm → stepOtpCode → stepPostAction
```

| Step                 | Purpose                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `stepNavigate`       | Go to bank home page, wait for readiness                               |
| `stepParseLoginPage` | **Parse HTML structure once** — cache child frames for all later steps |
| `stepFillAndSubmit`  | Resolve fields by visible text/label/placeholder, fill, click submit   |
| `stepCheckResult`    | Check URL/page for success or error                                    |
| `stepOtpConfirm`     | Detect OTP screen, click "Send SMS" trigger                            |
| `stepOtpCode`        | Get code from `otpCodeRetriever`, fill, submit, verify                 |
| `stepPostAction`     | Wait for dashboard navigation                                          |

**Key design principle:** No hardcoded CSS selectors for login fields. The `SelectorResolver` finds inputs by visible Hebrew text (`placeholder`, `label`, `ariaLabel`) using the `wellKnownSelectors` dictionary. The HTML is parsed once in `stepParseLoginPage` — all child frames are cached and reused by every downstream step.

### Module Format

Full ESM (`"type": "module"`) with dual output:

```jsonc
// package.json exports
"exports": {
  ".": {
    "import": "./lib/index.mjs",   // ESM
    "require": "./lib/index.cjs"   // CJS (backwards compatible)
  }
}
```

### Test Coverage

| Category | Suites | Tests |
|---|---|---|
| Unit tests | 47 | 619 |
| Mocked E2E | 9 | 30 |
| Real E2E | 12 | 246 |
| **Total** | **68** | **895** |

Coverage thresholds are enforced and ratcheted — no PR can reduce coverage.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Performance Tips

### Browser context reuse

For parallel scraping of multiple banks, share a single browser and create isolated contexts:

```typescript
import { Camoufox } from '@hieutran094/camoufox-js';

const browser = await Camoufox({ headless: true });

const results = await Promise.all(
  banks.map(async ({ companyId, credentials }) => {
    const context = await browser.newContext();
    const scraper = createScraper({ companyId, startDate, browserContext: context });
    const result = await scraper.scrape(credentials);
    await context.close();
    return result;
  }),
);

await browser.close();
```

### Headless mode

Always use `headless: true` for production. Headed mode (`headless: false`) is useful for debugging and initial WAF challenges on new IPs.

### Timeout tuning

```typescript
const scraper = createScraper({
  companyId: CompanyTypes.leumi,
  startDate,
  defaultTimeout: 60000, // increase for slow connections (default: 30s)
  navigationRetryCount: 2, // retry navigation on failure (default: 0)
});
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Version Timeline

| Version | Date     | Milestone                                                                       |
| ------- | -------- | ------------------------------------------------------------------------------- |
| v6.7.2  | Sep 2025 | Initial fork from eshaham/israeli-bank-scrapers                                 |
| v6.9.2  | Oct 2025 | Native `fetch()`, unit tests for all scrapers, WAF retry for 403                |
| v7.0.0  | Nov 2025 | **Breaking:** Puppeteer → Playwright migration                                  |
| v7.1.0  | Nov 2025 | OTP auto-detection, `INVALID_OTP` error type, `persistentOtpToken`              |
| v7.3.0  | Dec 2025 | Mocked E2E tests, GenericBankScraper + BANK_REGISTRY                            |
| v7.5.0  | Jan 2026 | tsup build (Babel+TSC → esbuild), strict TypeScript, PascalCase convention      |
| v7.6.0  | Feb 2026 | 4-round selector fallback, resilient login field detection                      |
| v7.8.0  | Mar 2026 | ESLint strict + SelectorResolver dashboard, VisaCal & Beinleumi fixes           |
| v7.8.1  | Mar 2026 | Login middleware chain, ScraperConfig central bank configuration                |
| v7.9.0  | Mar 2026 | **Camoufox** replaces playwright-extra+stealth (Firefox anti-detect, C++ level) |
| v7.10.0 | Mar 2026 | Full ESM migration, `stepParseLoginPage` HTML parser middleware                 |
| v8.0.0  | Mar 2026 | Strict ESLint + JSDoc on all functions, I-prefix interfaces, 895 tests          |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Cloudflare WAF bypass — Camoufox Firefox anti-detect (C++-level stealth, no plugins)
- [x] Structured `WAF_BLOCKED` error type with actionable suggestions
- [x] Puppeteer → Playwright migration (v7.0) → Camoufox anti-detect (v7.9)
- [x] Full ESM migration — `"type": "module"`, dual CJS/ESM output
- [x] Login middleware chain — `stepParseLoginPage` HTML parser caches frames for all steps
- [x] WellKnown selector system — finds login fields by visible text, label, placeholder (no CSS IDs)
- [x] Automatic OTP handling for DOM banks (Beinleumi, Discount) — no manual steps
- [x] `INVALID_OTP` error type — fast fail (5s) with clear message when code is wrong/expired
- [x] `persistentOtpToken` surfaced in scrape result for session reuse
- [x] Zero-Compromise ESLint: strict types, JSDoc on all functions, I-prefix interfaces, architectural bans
- [x] `GenericBankScraper` + `BANK_REGISTRY` — add a new DOM bank in one config object
- [x] 4-round selector fallback — scraper auto-discovers login fields even if IDs change
- [x] Remove all hardcoded CSS selectors from login fields — visible text first
- [x] TypeDoc API reference auto-published at [sergienko4.github.io/israeli-bank-scrapers](https://sergienko4.github.io/israeli-bank-scrapers/)
- [ ] Replace `playwright` dependency with `playwright-core` (Camoufox provides the browser binary)
- [ ] Configurable proxy support for residential IP routing

See the [open issues](https://github.com/sergienko4/israeli-bank-scrapers/issues) for a full list of proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions are welcome!

1. Fork the repo
2. Create your branch (`git checkout -b fix/description`)
3. Make changes, run `npm run build && npm test && npm run lint`
4. Commit with [conventional commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, `refactor:`)
5. Push and open a PR

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Known Projects

Projects using this library:

- [israeli-bank-scrapers-to-actual-budget](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget) — Automatic bank transaction sync to Actual Budget
- [Israeli YNAB updater](https://github.com/eshaham/israeli-ynab-updater) — Export bank data to YNAB
- [Caspion](https://github.com/brafdlog/caspion) — Auto-send transactions to budget tracking apps
- [Moneyman](https://github.com/daniel-hauser/moneyman) — Save transactions via GitHub Actions
- [Firefly III Importer](https://github.com/itairaz1/israeli-bank-firefly-importer) — Import to Firefly III
- [Clarify](https://github.com/tomyweiss/clarify-expences) — Personal finance tracking
- [Asher MCP](https://github.com/shlomiuziel/asher-mcp) — Financial data via Model Context Protocol

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Eugene Sergienko — [@sergienko4](https://github.com/sergienko4)

Project Link: [github.com/sergienko4/israeli-bank-scrapers](https://github.com/sergienko4/israeli-bank-scrapers)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->

[contributors-shield]: https://img.shields.io/github/contributors/sergienko4/israeli-bank-scrapers.svg?style=for-the-badge
[contributors-url]: https://github.com/sergienko4/israeli-bank-scrapers/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/sergienko4/israeli-bank-scrapers.svg?style=for-the-badge
[forks-url]: https://github.com/sergienko4/israeli-bank-scrapers/network/members
[stars-shield]: https://img.shields.io/github/stars/sergienko4/israeli-bank-scrapers.svg?style=for-the-badge
[stars-url]: https://github.com/sergienko4/israeli-bank-scrapers/stargazers
[issues-shield]: https://img.shields.io/github/issues/sergienko4/israeli-bank-scrapers.svg?style=for-the-badge
[issues-url]: https://github.com/sergienko4/israeli-bank-scrapers/issues
[license-shield]: https://img.shields.io/github/license/sergienko4/israeli-bank-scrapers.svg?style=for-the-badge
[license-url]: https://github.com/sergienko4/israeli-bank-scrapers/blob/main/LICENSE
[npm-shield]: https://img.shields.io/npm/v/@sergienko4/israeli-bank-scrapers?style=for-the-badge&logo=npm&logoColor=white
[npm-url]: https://www.npmjs.com/package/@sergienko4/israeli-bank-scrapers
[ci-shield]: https://img.shields.io/github/actions/workflow/status/sergienko4/israeli-bank-scrapers/nodeCI.yml?style=for-the-badge&logo=github&label=CI
[ci-url]: https://github.com/sergienko4/israeli-bank-scrapers/actions/workflows/nodeCI.yml
[ts-shield]: https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[ts-url]: https://www.typescriptlang.org
[node-shield]: https://img.shields.io/badge/Node.js-%3E%3D22.14-339933?style=for-the-badge&logo=node.js&logoColor=white
[node-url]: https://nodejs.org
[camoufox-shield]: https://img.shields.io/badge/Camoufox-0.6-FF6600?style=for-the-badge&logo=firefox&logoColor=white
[camoufox-url]: https://github.com/niceboyatcomputers/camoufox
[pw-shield]: https://img.shields.io/badge/Playwright-1.58-2EAD33?style=for-the-badge&logo=playwright&logoColor=white
[pw-url]: https://playwright.dev
[jest-shield]: https://img.shields.io/badge/Jest-30-C21325?style=for-the-badge&logo=jest&logoColor=white
[jest-url]: https://jestjs.io
[eslint-shield]: https://img.shields.io/badge/ESLint-10-4B32C3?style=for-the-badge&logo=eslint&logoColor=white
[eslint-url]: https://eslint.org
[docs-shield]: https://img.shields.io/badge/API_Docs-TypeDoc-blue?style=for-the-badge&logo=typescript&logoColor=white
[docs-url]: https://sergienko4.github.io/israeli-bank-scrapers/
