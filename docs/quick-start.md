# Quick Start

Get the first transaction from Bank Hapoalim in three steps.

## 1. Install

```sh
npm install @sergienko4/israeli-bank-scrapers
```

Requirements:

| Tool | Minimum | Why |
|---|---|---|
| Node.js | `>= 22.14.0` | ESM-by-default + `node:crypto` `randomUUID` |
| npm | `>= 10` | Workspaces + `--access public` provenance |
| Disk | ~500 MB | Camoufox bundle cached under `~/.cache/camoufox/` |

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

The `***NNNN`, `<merchant:N>`, and `+***`/`-***` markers are produced by the [PII redactor](observability/redaction.md). Every log line, captured network body, and DOM snapshot goes through the same redactor *before* it touches disk.

The `balance` field is populated by [BALANCE-RESOLVE.final](phases/balance-resolve.md) (browser banks) or [API-DIRECT-SCRAPE.final](phases/api-direct-scrape.md) (api-direct banks) — one source of truth across both paths.

## What next?

- Bank not Hapoalim? — pick yours in [Banks](banks/index.md); each page lists credentials + OTP behavior + known quirks.
- Need OTP? — see [Phase → OTP-TRIGGER](phases/otp-trigger.md) and [OTP-FILL](phases/otp-fill.md).
- WAF block? — [Error Types → WAF Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers#error-types) in the README.
- Parallel scraping? — [README → Advanced Usage](https://github.com/sergienko4/israeli-bank-scrapers#advanced-usage).
