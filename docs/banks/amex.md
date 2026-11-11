# Amex (American Express)

|                |                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Amex`                                                                                                                                               |
| Engine         | **API-direct** (no browser)                                                                                                                          |
| Credentials    | `id`, `card6Digits`, `password` (optional `otpLongTermToken`)                                                                                        |
| OTP            | —                                                                                                                                                    |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                |
| Source         | [`Banks/Amex/AmexPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Amex/AmexPipeline.ts) |

## Quick example

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

// The key kept from the previous run — undefined on the first run.
let storedKey: string | undefined;

const scraper = createScraper({
  companyId: CompanyTypes.Amex,
  startDate: new Date('2024-01-01'),
});

const result = await scraper.scrape({
  id: '123456789',
  card6Digits: '123456',
  password: 'mypassword',
  otpLongTermToken: storedKey, // optional — the previous run's persistentOtpToken
});

storedKey = result.persistentOtpToken; // the same key every run — keep it
```

## Login

Amex logs in over its ring mobile gateway, `ring.americanexpress.co.il`, and
sends no SMS. It is a member of [the Ring family](../phases/api-direct-scrape.md#the-ring-family-isracard-and-amex):
the login steps, their success codes and the warm start are Isracard's, step for
step — see [Isracard → Login](isracard.md#login) and
[Isracard → Warm start](isracard.md#warm-start). Only the ring constants differ.
`AMEX_API_DIRECT_CALL` (`Registry/Config/PipelineBankConfigAmex.ts`) builds the
steps from Amex's ring constants (`AMEX_RING`): host
`ring.americanexpress.co.il`, app id `ma`, domain `amex` and company code `77`.

`AMEX_TRANSPORT` registers the `service` URL and selects Node's own `fetch`
(`nativeFetch`) with a cookie jar, so no browser starts. Browser options passed
to `createScraper` are no longer supported; see the
[migration notes](../configuration.md#removed-browser-options).

## Scrape

The `AMEX_SHAPE` `IApiDirectScrapeShape` (`Banks/Amex/scrape/AmexShape.ts`) is
built by the shared ring factory, so cards, transactions and balance follow
[Isracard → Scrape](isracard.md#scrape): one account per card, one
`GetTransactionsList` request per card per billing month, and the card's next
debit as its balance. See [Balance resolution](../architecture/balance-resolve.md).

## Known quirks

- Amex + Isracard share a sequential test group (`scripts/run-real-suite.ts` WORKER_GROUPS) — Amex must finish before Isracard logs in on the same customer-side session.
- Every ring reply carries the bank's verdict inside an HTTP 200; a reply the
  bank did not confirm fails its call, and an expired session triggers the warm
  run's one recovery re-login — as on Isracard.
