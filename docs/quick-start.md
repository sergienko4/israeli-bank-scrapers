# Quick Start

Get the first transaction from Bank Hapoalim in three steps.

## 1. Install

```sh
npm install @sergienko4/israeli-bank-scrapers
```

Requirements:

| Tool    | Minimum      | Why                                                                         |
| ------- | ------------ | --------------------------------------------------------------------------- |
| Node.js | `>= 24.11.0` | First Node 24 LTS; bundles OpenSSL 3.5, which OneZero's TLS handshake needs |
| npm     | `>= 10`      | Workspaces + `--access public` provenance                                   |

No browser binary, browser cache or native browser-fingerprinting module is
required. Authentication and collection both use HTTP.

## 2. Scrape

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.Hapoalim,
  startDate: new Date('2024-01-01'),
  // Hapoalim texts a code when it asks for one.
  otpCodeRetriever: async phoneHint => await askForSmsCode(phoneHint),
});

const result = await scraper.scrape({
  userCode: '1234567',
  password: 'mypassword',
});

if (result.success) {
  for (const [index, acc] of (result.accounts ?? []).entries()) {
    console.log(`Account ${index + 1}: ${acc.txns.length} txns, balance ${acc.balance}`);
  }
} else {
  console.error(result.errorType, result.errorMessage);
}
```

Field names and OTP callback placement per bank live in [Banks → your bank](banks/index.md).

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

The `***NNNN`, `<merchant:N>`, and `+***`/`-***` markers are produced by the [PII redactor](observability/redaction.md). Log lines and captured network bodies go through the redactor _before_ they touch disk.

The `balance` field is populated by [API-DIRECT-SCRAPE.final](phases/api-direct-scrape.md).

## What next?

- Bank not Hapoalim? — pick yours in [Banks](banks/index.md); each page lists credentials + OTP behavior + known quirks.
- Need OTP? — see [API-DIRECT-CALL](phases/api-direct-call.md).
- WAF block? — see [Troubleshooting](troubleshooting.md#waf_blocked).
- Parallel scraping? — see [Advanced usage](advanced-usage.md).
