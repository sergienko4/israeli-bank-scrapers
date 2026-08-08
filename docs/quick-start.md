# Quick Start

Get the first transaction from Bank Hapoalim in three steps.

## 1. Install

```sh
npm install @sergienko4/israeli-bank-scrapers
```

Requirements:

| Tool    | Minimum      | Why                                               |
| ------- | ------------ | ------------------------------------------------- |
| Node.js | `>= 22.14.0` | ESM-by-default + `node:crypto` `randomUUID`       |
| npm     | `>= 10`      | Workspaces + `--access public` provenance         |
| Disk    | ~1.3 GB      | Camoufox bundle cached under `~/.cache/camoufox/` |

> The bundle is downloaded on **first launch**, not at install time, so the
> first scrape on a cold cache is substantially slower than later ones.

### Tuning the launch

| Environment variable         | Default          | Why you would change it                                                                                                                                                          |
| ---------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAMOUFOX_LAUNCH_TIMEOUT_MS` | `300000` (5 min) | Bounds browser launch. The default is deliberately generous because the first launch downloads the bundle described above. Raise it on a slow link; lower it to fail fast in CI. |

The bound exists so a browser that never comes up produces a rejection naming
the likely cause, rather than leaving the launch promise permanently unsettled.
An unsettled launch drains the event loop, and a caller using top-level `await`
then exits silently with code `13` and no diagnostic output. The environment
variable name is exported as `CAMOUFOX_LAUNCH_TIMEOUT_ENV` and its default as
`DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS`.

If a launch instead fails with `Could not locate the bindings file`, the
`better-sqlite3` native binding was never compiled. This happens when
dependencies were installed with `--ignore-scripts`; reinstall without that
flag, or rebuild the binding with `npm rebuild better-sqlite3`.

## 2. Scrape

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.Hapoalim,
  startDate: new Date('2024-01-01'),
});

const result = await scraper.scrape({
  userCode: '1234567',
  password: 'mypassword',
});

if (result.success) {
  for (const acc of result.accounts!) {
    console.log(`${acc.accountNumber}: ${acc.txns.length} txns, balance ${acc.balance}`);
  }
} else {
  console.error(result.errorType, result.errorMessage);
}
```

Field names per bank live in [Banks → your bank](banks/index.md). Banks marked **API-direct** read credentials slightly differently — see [OneZero](banks/onezero.md), [Pepper](banks/pepper.md), [PayBox](banks/paybox.md).

## 3. Inspect the result

```json
{
  "success": true,
  "accounts": [
    {
      "accountNumber": "****1234",
      "balance": 0,
      "txns": [
        { "date": "2024-01-15", "description": "<merchant:12>", "originalAmount": -*** }
      ]
    }
  ]
}
```

The `***NNNN`, `<merchant:N>`, and `+***`/`-***` markers are produced by the [PII redactor](observability/redaction.md). Every log line, captured network body, and DOM snapshot goes through the same redactor _before_ it touches disk.

The `balance` field is populated by [BALANCE-RESOLVE.final](phases/balance-resolve.md) (browser banks) or [API-DIRECT-SCRAPE.final](phases/api-direct-scrape.md) (api-direct banks) — one source of truth across both paths.

## What next?

- Bank not Hapoalim? — pick yours in [Banks](banks/index.md); each page lists credentials + OTP behavior + known quirks.
- Need OTP? — see [Phase → OTP-TRIGGER](phases/otp-trigger.md) and [OTP-FILL](phases/otp-fill.md).
- WAF block? — [Error Types → WAF Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers#error-types) in the README.
- Parallel scraping? — [README → Advanced Usage](https://github.com/sergienko4/israeli-bank-scrapers#advanced-usage).
