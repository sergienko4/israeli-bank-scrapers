<a id="readme-top"></a>

<!-- ALL-CONTRIBUTORS-BADGE:START -->
[![All Contributors](https://img.shields.io/badge/all_contributors-15-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->
[![npm version](https://img.shields.io/npm/v/@sergienko4/israeli-bank-scrapers?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/@sergienko4/israeli-bank-scrapers)
[![CI](https://img.shields.io/github/actions/workflow/status/sergienko4/israeli-bank-scrapers/nodeCI.yml?style=for-the-badge&logo=github&label=CI)](https://github.com/sergienko4/israeli-bank-scrapers/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/github/license/sergienko4/israeli-bank-scrapers?style=for-the-badge)](./LICENSE)
[![API Docs](https://img.shields.io/badge/API_Docs-TypeDoc-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://sergienko4.github.io/israeli-bank-scrapers/)
[![npm downloads](https://img.shields.io/npm/dm/@sergienko4/israeli-bank-scrapers?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/@sergienko4/israeli-bank-scrapers)
[![SonarCloud](https://img.shields.io/sonar/quality_gate/sergienko4_israeli-bank-scrapers?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge&logo=sonarcloud&logoColor=white)](https://sonarcloud.io/summary/overall?id=sergienko4_israeli-bank-scrapers)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/sergienko4/israeli-bank-scrapers?style=for-the-badge&label=OSSF)](https://securityscorecards.dev/viewer/?uri=github.com/sergienko4/israeli-bank-scrapers)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022.14-green?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)

# Israeli Bank Scrapers

Scrape transactions from all **18 Israeli banks and credit card companies** with built-in **Cloudflare WAF bypass**.

Maintained fork of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers), completely rewritten with [Camoufox](https://github.com/niceboyatcomputers/camoufox) (Firefox anti-detect), Playwright, and TypeScript 5.9 strict mode.

```sh
npm install @sergienko4/israeli-bank-scrapers
```

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**

- [What's Different](#whats-different)
- [Usage](#usage)
- [Supported Institutions (18)](#supported-institutions-18)
- [OTP (Two-Factor Authentication)](#otp-two-factor-authentication)
- [Error Types](#error-types)
- [Advanced Usage](#advanced-usage)
- [Contributors](#contributors)
- [Links](#links)
- [Known Projects](#known-projects)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## What's Different

| | Upstream | This Fork |
|---|---|---|
| WAF bypass | No (Puppeteer blocked) | Yes (Camoufox, first attempt) |
| Login detection | Hardcoded CSS | 7-strategy auto-resolver |
| OTP | Manual | Auto-detect + fill |
| Module format | CJS only | Dual ESM + CJS |
| Tests | ~600 | 972 (95 suites) |

## Usage

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.amex,
  startDate: new Date('2024-01-01'),
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
    console.error('Suggestions:', result.errorDetails.suggestions);
  }
}
```

<details>
<summary><strong>Supported Institutions (18)</strong></summary>

| Institution | Type | Credentials |
|---|---|---|
| Bank Hapoalim | Bank | `userCode`, `password` |
| Bank Leumi | Bank | `username`, `password` |
| Discount Bank | Bank | `id`, `password`, `num` |
| Mercantile Bank | Bank | `id`, `password`, `num` |
| Mizrahi Tefahot | Bank | `username`, `password` |
| Otsar Hahayal | Bank | `username`, `password` |
| Beinleumi | Bank | `username`, `password`, OTP |
| Massad | Bank | `username`, `password` |
| Yahav | Bank | `username`, `nationalID`, `password` |
| Pagi | Bank | `username`, `password` |
| OneZero | Bank | `email`, `password`, OTP |
| Beyahad Bishvilha | Bank | `id`, `password` |
| Behatsdaa | Bank | `id`, `password` |
| Amex | Credit Card | `id`, `card6Digits`, `password` |
| Isracard | Credit Card | `id`, `card6Digits`, `password` |
| Visa Cal | Credit Card | `username`, `password` |
| Max | Credit Card | `username`, `password`, `id` (conditional) |

</details>

## OTP (Two-Factor Authentication)

**Browser banks** (Beinleumi, Discount) — pass callback in options:

```typescript
createScraper({
  companyId: CompanyTypes.beinleumi, startDate,
  otpCodeRetriever: async (phoneHint) => await getCodeFromUser(phoneHint),
});
```

**API banks** (OneZero) — pass callback in credentials:

```typescript
await scraper.scrape({
  email, password, phoneNumber: '+972...',
  otpCodeRetriever: async () => '123456',
});
// result.persistentOtpToken — save to skip SMS next run
```

## Error Types

| Error | Meaning |
|---|---|
| `INVALID_PASSWORD` | Wrong credentials |
| `INVALID_OTP` | Wrong/expired OTP code |
| `WAF_BLOCKED` | Cloudflare block — check `errorDetails.suggestions` |
| `TIMEOUT` | Page load timeout — increase `defaultTimeout` |
| `TWO_FACTOR_RETRIEVER_MISSING` | OTP needed but no callback set |

<details>
<summary><strong>WAF Troubleshooting</strong></summary>

Camoufox passes most challenges automatically. If you still get `WAF_BLOCKED`:

| Scenario | Fix |
|---|---|
| 403 after login | Wait 1-2 hours, reduce frequency |
| Datacenter IP blocked | Use residential proxy |
| Turnstile CAPTCHA | Run once headed to pass initial challenge |
| Parallel failures | Share browser, add 2-5s delay |

</details>

## Advanced Usage

<details>
<summary><strong>Parallel scraping with shared browser</strong></summary>

```typescript
import { Camoufox } from '@hieutran094/camoufox-js';

const browser = await Camoufox({ headless: true });
const results = await Promise.all(
  banks.map(async ({ companyId, credentials }) => {
    const ctx = await browser.newContext();
    const scraper = createScraper({ companyId, startDate, browserContext: ctx });
    const result = await scraper.scrape(credentials);
    await ctx.close();
    return result;
  }),
);
await browser.close();
```

</details>

<details>
<summary><strong>Timeout and retry configuration</strong></summary>

```typescript
createScraper({
  companyId: CompanyTypes.leumi, startDate,
  defaultTimeout: 60000,
  navigationRetryCount: 2,
});
```

</details>

<details>
<summary><strong>Migration from upstream</strong></summary>

```diff
- npm install israeli-bank-scrapers
+ npm install @sergienko4/israeli-bank-scrapers
```

Same API. Both `import` and `require()` work. Types now use `I` prefix (`IScraper`, `IScraperScrapingResult`) — old names still work as aliases.

</details>

<details>
<summary><strong>Architecture</strong></summary>

Login flow uses an 8-step middleware chain:

```
navigate > parse-page > fill > wait > check-result > [otp-confirm > otp-code] > post-action
```

Fields resolved by 7-strategy `SelectorResolver` (label text, textContent walk-up, placeholder, aria, name, CSS, xpath). After first field resolves, `FormAnchor` scopes subsequent fields to the discovered `<form>`.

All 18 institutions configured via declarative `LoginConfig` objects. Adding a new bank requires one config object.

</details>

<details>
<summary><strong>Version history</strong></summary>

| Version | Milestone |
|---|---|
| v6.7.2 | Initial fork from upstream |
| v7.0.0 | Puppeteer to Playwright |
| v7.9.0 | Camoufox anti-detect browser |
| v7.10.0 | Full ESM migration |
| v8.0.0 | Strict ESLint + JSDoc, I-prefix interfaces, form-anchor |

</details>

## Contributors

Thanks to the original [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) contributors whose work inspired this fork:

<!-- ALL-CONTRIBUTORS-LIST:START -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/sergienko4"><img src="https://avatars.githubusercontent.com/u/16467411?v=4?s=80" width="80px;" alt="Sergienko Eugune"/><br /><sub><b>Sergienko Eugune</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=sergienko4" title="Code">💻</a> <a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=sergienko4" title="Documentation">📖</a> <a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=sergienko4" title="Tests">⚠️</a> <a href="#maintenance-sergienko4" title="Maintenance">🚧</a> <a href="#infra-sergienko4" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://elad.shaham.net/"><img src="https://avatars.githubusercontent.com/u/7040645?v=4?s=80" width="80px;" alt="Elad Shaham"/><br /><sub><b>Elad Shaham</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=eshaham" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/sebikaplun"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="sebikaplun"/><br /><sub><b>sebikaplun</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=sebikaplun" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/esakal"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="esakal"/><br /><sub><b>esakal</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=esakal" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/ezzatq"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="ezzatq"/><br /><sub><b>ezzatq</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=ezzatq" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/kfirarad"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="kfirarad"/><br /><sub><b>kfirarad</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=kfirarad" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/baruchiro"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="baruchiro"/><br /><sub><b>baruchiro</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=baruchiro" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/matanelgabsi"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="matanelgabsi"/><br /><sub><b>matanelgabsi</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=matanelgabsi" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/dratler"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="dratler"/><br /><sub><b>dratler</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=dratler" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/dudiventura"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="dudiventura"/><br /><sub><b>dudiventura</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=dudiventura" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/gczobel"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="gczobel"/><br /><sub><b>gczobel</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=gczobel" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/orzarchi"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="orzarchi"/><br /><sub><b>orzarchi</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=orzarchi" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/erezd"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="erezd"/><br /><sub><b>erezd</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=erezd" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/erikash"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="erikash"/><br /><sub><b>erikash</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=erikash" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/daniel-hauser"><img src="https://avatars.githubusercontent.com/u/0?v=4?s=80" width="80px;" alt="daniel-hauser"/><br /><sub><b>daniel-hauser</b></sub></a><br /><a href="https://github.com/sergienko4/israeli-bank-scrapers/commits?author=daniel-hauser" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## Links

- [API Documentation (TypeDoc)](https://sergienko4.github.io/israeli-bank-scrapers/)
- [Changelog](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/CHANGELOG.md)
- [Contributing](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/CONTRIBUTING.md)

## Known Projects

- [israeli-bank-scrapers-to-actual-budget](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget) — Sync to Actual Budget
- [Caspion](https://github.com/brafdlog/caspion) — Auto-send to budget apps
- [Moneyman](https://github.com/daniel-hauser/moneyman) — Save via GitHub Actions
- [Firefly III Importer](https://github.com/itairaz1/israeli-bank-firefly-importer) — Import to Firefly III

## License

MIT. Maintained by [@sergienko4](https://github.com/sergienko4). Based on [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers).
