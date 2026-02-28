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
    <li><a href="#usage">Usage</a></li>
    <li><a href="#waf-troubleshooting">WAF Troubleshooting</a></li>
    <li><a href="#advanced-options">Advanced Options</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#known-projects">Known Projects</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

---

## About

**Maintained fork** of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) with anti-detection that bypasses Cloudflare Bot Management — the main blocker for Amex and Isracard scraping since early 2026.

### What's different from upstream?

| Feature               | Upstream (Puppeteer)                 | This Fork (Playwright)                                                   |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| Browser engine        | Puppeteer (CDP fingerprint detected) | Playwright (bypasses WAF natively)                                       |
| Cloudflare WAF bypass | No                                   | First-attempt pass — no stealth or retry needed                          |
| WAF error reporting   | "Unknown error"                      | Structured `WAF_BLOCKED` with provider, HTTP status, suggestions         |
| Human-like timing     | Partial                              | Full (1.5-3s delay before API calls, randomized form input)              |
| OTP auto-detection    | Manual                               | Automatic — detects OTP screen, fills code, no browser changes needed    |
| Architecture          | Per-bank scrapers                    | `GenericBankScraper` + `BANK_REGISTRY` — add a bank in one config object |
| E2E test coverage     | 3 banks                              | All 18 institutions                                                      |

Playwright migration and WAF bypass by [@sergienko4](https://github.com/sergienko4). Validated on all 18 institutions across local, Azure, and Oracle Cloud servers.

### Built With

[![TypeScript][ts-shield]][ts-url] [![Node.js][node-shield]][node-url] [![Playwright][pw-shield]][pw-url] [![Jest][jest-shield]][jest-url] [![ESLint][eslint-shield]][eslint-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Supported Institutions

<details>
  <summary>All 18 Israeli banks and credit card companies:</summary>
  <ol>


| Institution        | Type        | Credentials                          | Contributors                                                                           |
| ------------------ | ----------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| Bank Hapoalim      | Bank        | `userCode`, `password`               | [@sebikaplun](https://github.com/sebikaplun)                                           |
| Bank Leumi         | Bank        | `username`, `password`               | [@esakal](https://github.com/esakal)                                                   |
| Discount Bank      | Bank        | `id`, `password`, `num`              |                                                                                        |
| Mercantile Bank    | Bank        | `id`, `password`, `num`              | [@ezzatq](https://github.com/ezzatq), [@kfirarad](https://github.com/kfirarad)         |
| Mizrahi Tefahot    | Bank        | `username`, `password`               | [@baruchiro](https://github.com/baruchiro)                                             |
| Bank Otsar Hahayal | Bank        | `username`, `password`               | [@matanelgabsi](https://github.com/matanelgabsi)                                       |
| Union Bank         | Bank        | `username`, `password`               | [@dratler](https://github.com/dratler), [@dudiventura](https://github.com/dudiventura) |
| Bank Yahav         | Bank        | `username`, `nationalID`, `password` | [@gczobel](https://github.com/gczobel)                                                 |
| Bank Massad        | Bank        | `username`, `password`               |                                                                                        |
| Pagi Bank          | Bank        | `username`, `password`               |                                                                                        |
| One Zero           | Bank        | `email`, `password`, OTP             | [@orzarchi](https://github.com/orzarchi), [@sergienko4](https://github.com/sergienko4) |
| Beinleumi          | Bank        | `username`, `password`, OTP          | [@sergienko4](https://github.com/sergienko4)                                           |
| Beyahad Bishvilha  | Bank        | `id`, `password`                     | [@esakal](https://github.com/esakal)                                                   |
| Behatsdaa          | Bank        | `id`, `password`                     | [@daniel-hauser](https://github.com/daniel-hauser)                                     |
| Amex               | Credit Card | `id`, `card6Digits`, `password`      | [@erezd](https://github.com/erezd), [@sergienko4](https://github.com/sergienko4)       |
| Isracard           | Credit Card | `id`, `card6Digits`, `password`      | [@sergienko4](https://github.com/sergienko4)                                           |
| Visa Cal           | Credit Card | `username`, `password`               | [@erikash](https://github.com/erikash), [@esakal](https://github.com/esakal)           |
| Max                | Credit Card | `username`, `password`               |                                                                                        |

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

## Usage

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.amex,
  startDate: new Date('2024-01-01'),
  combineInstallments: false,
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

## WAF Troubleshooting

Playwright bypasses most Cloudflare challenges automatically. If you still get `errorType: 'WAF_BLOCKED'`:

| Scenario            | What happens                         | Fix                                     |
| ------------------- | ------------------------------------ | --------------------------------------- |
| API-level 403       | Login succeeds but API calls blocked | Wait 1-2 hours, reduce scrape frequency |
| Datacenter IP block | Cloud provider IPs rate-limited      | Use residential proxy or Azure          |
| Turnstile CAPTCHA   | Interactive challenge on login page  | Use a trusted IP provider               |

> **Tip:** Playwright passes WAF on first attempt from most IPs. No stealth or retry needed.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Advanced Options

### External Browser

Pass your own Playwright browser instance:

```typescript
import { chromium } from 'playwright';

const browser = await chromium.launch();
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
const browser = await chromium.launch();
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

Some scrapers support opt-in features for breaking changes. See the [OptInFeatures type](./src/scrapers/interface.ts).

---

## Migration Notes

### v7.0.x → v7.1.x

**New additions (non-breaking):**

- `ScraperOptions.otpCodeRetriever` — optional callback for DOM banks (Beinleumi, Discount). Not required — if omitted and OTP is detected, returns `TWO_FACTOR_RETRIEVER_MISSING`.
- `ScraperScrapingResult.persistentOtpToken` — optional token returned by banks supporting session reuse (e.g. OneZero). Save and pass as `credentials.otpLongTermToken` to skip SMS on next run.
- `ScraperErrorTypes.InvalidOtp = 'INVALID_OTP'` — new error type when OTP code is rejected.

**Deprecated (still works, no action needed):**

- `ScraperErrorTypes.General = 'GENERAL_ERROR'` — use `ScraperErrorTypes.Generic = 'GENERIC'` instead. Both values remain in the enum.

**Potentially breaking — `WafBlockError.apiBlock()` signature:**

```typescript
// Old (v7.0.x):
WafBlockError.apiBlock(httpStatus, pageUrl, pageTitle, responseSnippet);

// New (v7.1.x):
WafBlockError.apiBlock(httpStatus, pageUrl, { pageTitle, responseSnippet });
```

This only affects code that calls `WafBlockError.apiBlock()` directly. Consumers who only check `result.errorType === 'WAF_BLOCKED'` are unaffected.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Cloudflare WAF bypass (Playwright — no stealth or retry needed)
- [x] Structured `WAF_BLOCKED` error type with actionable suggestions
- [x] Playwright migration — bypasses WAF natively, no CDP fingerprint
- [x] Automatic OTP handling for DOM banks (Beinleumi, Discount) — no manual steps
- [x] `INVALID_OTP` error type — fast fail (5s) with clear message when code is wrong/expired
- [x] OneZero real-time balance via `balance(portfolioId, accountId)` GraphQL query
- [x] `persistentOtpToken` surfaced in scrape result for session reuse
- [x] Zero-Compromise ESLint gate: `no-any`, `no-unsafe-*`, explicit return types, 20-line/300-line limits
- [x] `GenericBankScraper` + `BANK_REGISTRY` — add a new DOM bank in one config object (no boilerplate)
- [x] 4-round selector fallback — scraper auto-discovers login fields even if IDs change
- [x] TypeDoc API reference auto-published at [sergienko4.github.io/israeli-bank-scrapers](https://sergienko4.github.io/israeli-bank-scrapers/)
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
[pw-shield]: https://img.shields.io/badge/Playwright-1.58-2EAD33?style=for-the-badge&logo=playwright&logoColor=white
[pw-url]: https://playwright.dev
[jest-shield]: https://img.shields.io/badge/Jest-30-C21325?style=for-the-badge&logo=jest&logoColor=white
[jest-url]: https://jestjs.io
[eslint-shield]: https://img.shields.io/badge/ESLint-9-4B32C3?style=for-the-badge&logo=eslint&logoColor=white
[eslint-url]: https://eslint.org
[docs-shield]: https://img.shields.io/badge/API_Docs-TypeDoc-blue?style=for-the-badge&logo=typescript&logoColor=white
[docs-url]: https://sergienko4.github.io/israeli-bank-scrapers/
