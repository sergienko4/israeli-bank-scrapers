# Max (formerly Leumi Card)

|                |                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CompanyTypes` | `Max`                                                                                                                                            |
| Engine         | **API-direct** (no browser)                                                                                                                      |
| Credentials    | `username`, `password`                                                                                                                           |
| OTP            | —                                                                                                                                                |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                            |
| Source         | [`Banks/Max/MaxPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Max/MaxPipeline.ts) |

## Quick example

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.Max,
  startDate: new Date('2024-01-01'),
});

const result = await scraper.scrape({ username: 'myuser', password: 'mypassword' });
```

## Login

Max logs in over its web app's own JSON API on `MAX_ORIGIN`
(`https://www.max.co.il`) and sends no SMS. `MAX_API_DIRECT_CALL`
(`Registry/Config/PipelineBankConfigMax.ts`) declares two steps:

| Step    | Endpoint                           | Sends                              | Returns                      |
| ------- | ---------------------------------- | ---------------------------------- | ---------------------------- |
| `prime` | `GET api/registered/clientcontext` | —                                  | the bank's pre-login cookies |
| `login` | `POST api/login/login`             | `username`, `password`, `id: null` | the session cookie           |

The session is a cookie, not an auth header. `MAX_HEADLESS` registers both
paths, selects Node's own `fetch` (`nativeFetch`) and keeps the run's cookies
(`sessionCookies`), so no browser starts. Browser options passed to
`createScraper` are no longer supported; see the
[migration notes](../configuration.md#removed-browser-options).

Every call, login and data alike, carries `MAX_STATIC_HEADERS`, the run's
session id (`sid`, the flow id the mediator mints once per run; credentials
cannot set it) and a fresh correlation id (`cid`). The
login step reads the result from `Result.LoginStatus`: `0` is success, `4`
fails the run as `INVALID_PASSWORD`, `1` as `CHANGE_PASSWORD`, and any other
value as `GENERIC`. The `id` field always goes as `null`; the bank asks for a
national ID only after repeated failed logins, and that reply is typed by its
`LoginStatus` like any other.

There is no long-term token: every run logs in cold, and `persistentOtpToken`
stays unset.

## Scrape

The `MAX_SHAPE` `IApiDirectScrapeShape` (`Banks/Max/scrape/MaxShape.ts`)
sends `maxHeaders` (the static headers plus `sid` and a fresh `cid`) on every
call:

- **Cards** — `customerUrl` reads `getHomePageData`; `extractCards` turns each
  entry of `Result.UserCards.Cards` into one account.
- **Transactions** — `getTransactionsAndGraphs`, one all-cards request per
  account per billing month (`txnsUrl` / `txnsExtractPage`). Each account keeps
  only its own card's rows from that reply.
- **Balance** — card-cycle: `ilsCycleDebit` reads the card's ILS
  `CycleSummary` entry already on the card, so there is no balance call. See
  [Balance resolution](../architecture/balance-resolve.md).

A data call without a live session cookie gets an empty `403`; the run fails
as `GENERIC` and does not log in again.

## Real-test output

A successful Max real-test run prints every transaction, grouped by account
and sorted newest-first, using the same masked listing as the other banks.
Account identifiers, amounts and descriptions stay masked. This diagnostic
output does not change the returned `accounts` or `txns`.
