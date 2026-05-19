<a id="readme-top"></a>

<!-- ALL-CONTRIBUTORS-BADGE:START -->

[![All Contributors](https://img.shields.io/badge/all_contributors-15-orange.svg?style=flat-square)](#contributors-)

<!-- ALL-CONTRIBUTORS-BADGE:END -->

[![npm version](https://img.shields.io/npm/v/@sergienko4/israeli-bank-scrapers?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/@sergienko4/israeli-bank-scrapers)
[![CI](https://img.shields.io/github/actions/workflow/status/sergienko4/israeli-bank-scrapers/pr.yml?style=for-the-badge&logo=github&label=CI)](https://github.com/sergienko4/israeli-bank-scrapers/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/github/license/sergienko4/israeli-bank-scrapers?style=for-the-badge)](./LICENSE)
[![API Docs](https://img.shields.io/badge/API_Docs-TypeDoc-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://sergienko4.github.io/israeli-bank-scrapers/)
[![npm downloads](https://img.shields.io/npm/dm/@sergienko4/israeli-bank-scrapers?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/@sergienko4/israeli-bank-scrapers)
[![SonarCloud](https://img.shields.io/sonar/quality_gate/sergienko4_israeli-bank-scrapers?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge&logo=sonarcloud&logoColor=white)](https://sonarcloud.io/summary/overall?id=sergienko4_israeli-bank-scrapers)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/sergienko4/israeli-bank-scrapers?style=for-the-badge&label=OSSF)](https://securityscorecards.dev/viewer/?uri=github.com/sergienko4/israeli-bank-scrapers)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022.14-green?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)

# Israeli Bank Scrapers

Scrape transactions from **Israeli banks and credit card companies** with built-in **Cloudflare WAF bypass**.

Maintained fork of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers), completely rewritten with [Camoufox](https://github.com/niceboyatcomputers/camoufox) (Firefox anti-detect), Playwright, and TypeScript 6.0 strict mode.

```sh
npm install @sergienko4/israeli-bank-scrapers
```

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

**Table of Contents**

- [What's Different](#whats-different)
- [Usage](#usage)
- [Supported Institutions](#supported-institutions)
- [OTP (Two-Factor Authentication)](#otp-two-factor-authentication)
- [Error Types](#error-types)
- [Logging & Bug Reports](#logging--bug-reports)
- [Advanced Usage](#advanced-usage)
- [Contributors](#contributors)
- [Links](#links)
- [Known Projects](#known-projects)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## What's Different

|                 | Upstream               | This Fork                     |
| --------------- | ---------------------- | ----------------------------- |
| WAF bypass      | No (Puppeteer blocked) | Yes (Camoufox, first attempt) |
| Login detection | Hardcoded CSS          | 7-strategy auto-resolver      |
| OTP             | Manual                 | Auto-detect + fill            |
| Module format   | CJS only               | Dual ESM + CJS                |

## Usage

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.Amex,
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

## Supported Institutions

<details>
<summary><strong>Full list</strong></summary>

| Institution       | Type        | Credentials                                 |
| ----------------- | ----------- | ------------------------------------------- |
| Bank Hapoalim     | Bank        | `userCode`, `password`, OTP (when prompted) |
| Bank Leumi        | Bank        | `username`, `password`                      |
| Discount Bank     | Bank        | `id`, `password`, `num`                     |
| Mercantile Bank   | Bank        | `id`, `password`, `num`                     |
| Mizrahi Tefahot   | Bank        | `username`, `password`                      |
| Otsar Hahayal     | Bank        | `username`, `password`                      |
| Beinleumi         | Bank        | `username`, `password`, OTP                 |
| Massad            | Bank        | `username`, `password`                      |
| Yahav             | Bank        | `username`, `nationalID`, `password`        |
| Pagi              | Bank        | `username`, `password`                      |
| OneZero           | Bank        | `email`, `password`, OTP                    |
| Beyahad Bishvilha | Bank        | `id`, `password`                            |
| Behatsdaa         | Bank        | `id`, `password`                            |
| Amex              | Credit Card | `id`, `card6Digits`, `password`             |
| Isracard          | Credit Card | `id`, `card6Digits`, `password`             |
| Visa Cal          | Credit Card | `username`, `password`                      |
| Max               | Credit Card | `username`, `password`, `id` (conditional)  |
| Pepper            | Bank        | not supported yet — see note below          |

</details>

> **Note — Pepper (Bank Leumi digital):** the `CompanyTypes.Pepper` enum entry
> exists but is currently **unsupported**. The login flow uses Transmit
> Security and depends on a fingerprint payload bound to a specific
> Android APK build (and likely Play Integrity attestation from a real
> device). The pipeline’s API-direct call reaches the bank, password is
> accepted (HTTP 200, `errorCode: "0"`), but the SMS challenge is silently
> dropped — bisected to pre-existing breakage (commit `c23a0669`). The E2E
> happy-path test is opt-in via `PEPPER_E2E_OPT_IN=1`. A re-enabling fix
> needs a fresh APK fingerprint capture and possibly a real-device
> attestation proxy.

## OTP (Two-Factor Authentication)

**Browser banks** (Beinleumi group, Hapoalim) — pass callback in options:

```typescript
createScraper({
  companyId: CompanyTypes.Beinleumi,
  startDate,
  otpCodeRetriever: async phoneHint => await getCodeFromUser(phoneHint),
});
```

> **Hapoalim:** OTP is conditional — when the bank prompts for an SMS code
> (e.g. login from an unrecognised device), the same `otpCodeRetriever`
> callback is invoked. On device-remembered sessions no OTP is asked
> and the callback is never called.

**API banks** (OneZero) — pass callback in credentials:

```typescript
await scraper.scrape({
  email,
  password,
  phoneNumber: '+972...',
  otpCodeRetriever: async () => '123456',
});
// result.persistentOtpToken — save to skip SMS next run
```

## Error Types

| Error                          | Meaning                                             |
| ------------------------------ | --------------------------------------------------- |
| `INVALID_PASSWORD`             | Wrong credentials                                   |
| `INVALID_OTP`                  | Wrong/expired OTP code                              |
| `WAF_BLOCKED`                  | Cloudflare block — check `errorDetails.suggestions` |
| `TIMEOUT`                      | Page load timeout — increase `defaultTimeout`       |
| `TWO_FACTOR_RETRIEVER_MISSING` | OTP needed but no callback set                      |

<details>
<summary><strong>WAF Troubleshooting</strong></summary>

Camoufox passes most challenges automatically. If you still get `WAF_BLOCKED`:

| Scenario              | Fix                                       |
| --------------------- | ----------------------------------------- |
| 403 after login       | Wait 1-2 hours, reduce frequency          |
| Datacenter IP blocked | Use residential proxy                     |
| Turnstile CAPTCHA     | Run once headed to pass initial challenge |
| Parallel failures     | Share browser, add 2-5s delay             |

</details>

## Logging & Bug Reports

The package **auto-redacts PII before any line is written** — terminal,
log files, captured network bodies, captured DOM snapshots. You can
share `pipeline.log`, `network/*.json`, or `screenshots/*.html`
publicly without exposing your customers' data.

### What gets redacted, and what survives

| Category                            | Example before → after                            |
| ----------------------------------- | ------------------------------------------------- |
| Account / card / Israeli ID / phone | `12-170-456789` → `***6789`                       |
| Cardholder / customer name          | `דני משהו` → `<name:8>` (length tag)              |
| Merchant description                | `סופר-פארם רמת גן` → `<merchant:14>`              |
| Transaction amount                  | `-247.50` → `-***` (sign only)                    |
| Auth tokens / cookies / OTP codes   | `eyJhbGc...`, `123456` → `[REDACTED]`, `[OTP]`    |
| URLs                                | host + path preserved; PII query keys redacted    |
| HTML snapshots                      | text nodes + `value` attributes scrubbed in place |
| Anything unrecognised               | `[REDACTED]` (default-deny)                       |

The "stable hints" (`***NNNN`, `<merchant:N>`, `+***`/`-***`,
array-size markers) are deliberate — they preserve enough for us to
correlate failures across phases without ever showing raw PII.

### Filing a bug report

Attach **all three** if available:

1. `pipeline.log` — full Pino transcript of the run.
2. `network/*.json` — captured HTTP bodies (already redacted at write time).
3. `screenshots/*.html` — DOM snapshots per phase (already redacted).

Skip `screenshots/*.png` (raster images are not OCR-redacted today —
they may contain unredacted PII rendered by the bank's UI). If a PNG
is essential to the report, blur or crop before attaching.

### How redaction stays correct over time

Two independent enforcement layers keep raw PII out of the log
surface even as the codebase evolves:

- **Runtime layer** — `PiiRedactor.ts` is the single source of truth.
  Pino runs it as the `redact.censor` callback so every record is
  redacted _before_ any transport. `NetworkDiscovery` and
  `FixtureCapture` route their byte streams through the same
  redactor before persisting.
- **Commit-time layer** — ESLint AST selectors (T09 / T16) and an
  architecture-validator regex (`PII-Log` rule) reject pull requests
  that try to bypass the runtime by interpolating PII identifiers
  into `LOG.*` template literals or passing full payload objects
  under `result|accounts|transactions|...` keys.

If you spot a pattern that leaks past both layers, please open an
issue — that's a load-bearing bug, not cosmetic.

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
  companyId: CompanyTypes.Leumi,
  startDate,
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

Pipeline of typed phases. Each phase owns its mediator zone, its own well-known-selectors dictionary, and its own retry policy. Phases never reach into one another's state — communication happens via slim `Option<T>` fields on the pipeline context.

```
INIT → HOME → [PRE-LOGIN] → LOGIN → [OTP-TRIGGER → OTP-FILL] → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → TERMINATE
```

- `[PRE-LOGIN]` is opt-in — card banks with a separate "show login" toggle: Amex, Isracard, Max, VisaCal.
- `[OTP-TRIGGER → OTP-FILL]` is opt-in. Beinleumi group banks have both. Hapoalim uses OTP-FILL only, conditionally (see the OTP section above).
- `AUTH-DISCOVERY` separates the credential exchange from the dashboard handoff so post-auth signal capture (cookies, ids, tokens) is observable, redactable, and testable in isolation.

**Cross-cutting interceptors** run between phases — they don't own data, they observe and dismiss:

- **PopupInterceptor** — before HOME, ACCOUNT-RESOLVE, and DASHBOARD, the interceptor scans for modal overlays (privacy banners, new-feature promos, "you have a message" dialogs) and dismisses them by visible-text. If nothing matches, the next phase proceeds untouched. Necessary because bank SPAs commonly stack one promo on top of the login flow, and any unhandled click-target above the page blocks the phase mediator.
- **NetworkDiscovery + trace lifecycle** — every HTTP request and response the page issues is observed and indexed. The discovery layer learns each bank's per-account / per-card / per-statement endpoints at runtime (no hand-maintained URL list) and feeds them into the SCRAPE phase. Bodies are captured to disk only inside the configured boundary (post-auth onward) so pre-auth secrets never hit the trace; bodies + URLs flow through the central `PiiRedactor` before any write, so the on-disk artifacts are safe to share.

Inside the LOGIN phase, fields resolve through a 7-strategy `SelectorResolver` (visible Hebrew text → `textContent` walk-up → `placeholder` → `aria-label` → `name` → CSS → xpath). Once the first field matches, `FormAnchor` scopes the remaining fields to the discovered `<form>` so multi-form pages don't cross-pollute.

All institutions are configured via declarative `LoginConfig` objects. Adding a new bank means writing one config object — no bank-specific imperative code.

</details>

<details>
<summary><strong>Version history</strong></summary>

| Version | Milestone                                                                                                                                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v6.7.2  | Initial fork from upstream                                                                                                                                                                                                                     |
| v7.0.0  | Puppeteer to Playwright                                                                                                                                                                                                                        |
| v7.9.0  | Camoufox anti-detect browser                                                                                                                                                                                                                   |
| v7.10.0 | Full ESM migration                                                                                                                                                                                                                             |
| v8.0.0  | Strict ESLint + JSDoc, I-prefix interfaces, form-anchor                                                                                                                                                                                        |
| v8.1.0  | Integration test framework — 18 tests across 6 scrapers                                                                                                                                                                                        |
| v8.2.0  | SonarCloud static-analysis workflow + Max selectors via Hebrew text                                                                                                                                                                            |
| v8.2.1  | All bank logins migrated from CSS/ID selectors to visible Hebrew text                                                                                                                                                                          |
| v8.3.0  | Pipeline architecture v2 — Strategy / Builder / Mediator / Result patterns, AUTH-DISCOVERY phase + 100% phase isolation, cross-bank test factory (Phase H), TIMING ceilings, Telegram OTP delivery, PII redaction across log/network/snapshots |

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
