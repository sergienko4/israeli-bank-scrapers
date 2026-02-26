<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![npm version][npm-shield]][npm-url]
[![CI][ci-shield]][ci-url]
[![MIT License][license-shield]][license-url]

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
    <li><a href="#supported-banks">Supported Banks</a></li>
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

| Feature | Upstream | This Fork |
|---------|----------|-----------|
| Cloudflare WAF bypass | No | Automatic retry with exponential backoff (30s/60s/120s) |
| Anti-detection | Basic | Manual stealth overrides (webdriver, plugins, chrome.runtime) |
| WAF error reporting | "Unknown error" | Structured `WAF_BLOCKED` with provider, HTTP status, suggestions |
| Request interception | Blocks bot detection scripts (detectable) | Removed (CDP detection signal) |
| Human-like timing | Partial | Full (1.5-3s delay before API calls, randomized form input) |

Anti-detection and Cloudflare WAF bypass by [@sergienko4](https://github.com/sergienko4). Validated on Amex, Isracard, Discount, and Visa Cal across Azure and Oracle Cloud servers.

### Built With

[![TypeScript][ts-shield]][ts-url] [![Node.js][node-shield]][node-url] [![Playwright][pw-shield]][pw-url] [![Jest][jest-shield]][jest-url] [![ESLint][eslint-shield]][eslint-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Supported Banks

All 18 Israeli banks and credit card companies:

<table>
<tr><td>

| Bank | Contributors |
|------|-------------|
| Bank Hapoalim | [@sebikaplun](https://github.com/sebikaplun) |
| Leumi Bank | [@esakal](https://github.com/esakal) |
| Discount Bank | |
| Mercantile Bank | [@ezzatq](https://github.com/ezzatq), [@kfirarad](https://github.com/kfirarad) |
| Mizrahi Bank | [@baruchiro](https://github.com/baruchiro) |
| Otsar Hahayal | [@matanelgabsi](https://github.com/matanelgabsi) |
| Union Bank | Intuit FDP: [@dratler](https://github.com/dratler), [@kalinoy](https://github.com/kalinoy), [@shanigad](https://github.com/shanigad), [@dudiventura](https://github.com/dudiventura), [@NoamGoren](https://github.com/NoamGoren) |
| Massad | |
| Pagi Bank | |

</td><td>

| Bank | Contributors |
|------|-------------|
| Visa Cal | [@erikash](https://github.com/erikash), [@esakal](https://github.com/esakal), [@nirgin](https://github.com/nirgin) |
| Max (formerly Leumi Card) | |
| Isracard | WAF bypass by [@sergienko4](https://github.com/sergienko4) |
| Amex | [@erezd](https://github.com/erezd), WAF bypass by [@sergienko4](https://github.com/sergienko4) |
| Beinleumi | [@dudiventura](https://github.com/dudiventura) |
| Yahav | [@gczobel](https://github.com/gczobel) |
| Beyhad Bishvilha | [@esakal](https://github.com/esakal) |
| OneZero (experimental) | [@orzarchi](https://github.com/orzarchi) |
| Behatsdaa | [@daniel-hauser](https://github.com/daniel-hauser) |

</td></tr>
</table>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

* [Node.js](https://nodejs.org) >= 22.14.0

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

### Credentials per Bank

| Bank | Fields |
|------|--------|
| Hapoalim | `userCode`, `password` |
| Leumi | `username`, `password` |
| Discount, Mercantile | `id`, `password`, `num` |
| Mizrahi | `username`, `password` |
| Otsar Hahayal, Visa Cal, Max | `username`, `password` |
| Isracard, Amex | `id`, `card6Digits`, `password` |
| Yahav | `username`, `password`, `nationalID` |
| Beinleumi, Massad | `username`, `password` |
| Beyhad Bishvilha, Behatsdaa | `id`, `password` |
| Pagi | `username`, `password` |

All scrapers support up to one year of transaction history.

### Result Structure

```typescript
{
  success: boolean;
  accounts?: [{
    accountNumber: string;
    balance?: number;
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
  errorType?: 'INVALID_PASSWORD' | 'CHANGE_PASSWORD' | 'ACCOUNT_BLOCKED'
            | 'TIMEOUT' | 'GENERIC' | 'GENERAL_ERROR' | 'WAF_BLOCKED';
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

When Cloudflare blocks access, the scraper returns `errorType: 'WAF_BLOCKED'` with actionable suggestions:

| Scenario | What happens | Suggestions |
|----------|-------------|-------------|
| First-time 403 | Cloudflare challenge page, auto-retry with 30s backoff | Usually resolves on 2nd attempt |
| Repeated blocks | IP flagged from too many rapid attempts | Wait 1-2 hours between scrape runs |
| Datacenter IP | Oracle Cloud, AWS IPs are lower trust | Use Azure or residential proxy |
| Turnstile CAPTCHA | Cannot be solved by headless Chrome | Use a trusted IP provider |

> **Tip:** run scrapes 1-2 times per day with at least 1 hour between runs for best results.

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

Some companies require 2FA. Provide an OTP callback or a long-term token:

```typescript
const result = await scraper.scrape({
  email: 'user@example.com',
  password: 'pass',
  phoneNumber: '+972...',
  otpCodeRetriever: async () => {
    return '123456'; // Return OTP from SMS/email
  },
});
```

### Opt-In Features

Some scrapers support opt-in features for breaking changes. See the [OptInFeatures type](./src/scrapers/interface.ts).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Cloudflare WAF bypass (Playwright — no stealth or retry needed)
- [x] Structured `WAF_BLOCKED` error type with actionable suggestions
- [x] Playwright migration — bypasses WAF natively, no CDP fingerprint
- [ ] Configurable proxy support for residential IP routing
- [ ] Upstream PR to [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers)

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
