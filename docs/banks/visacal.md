# Visa Cal

| | |
|---|---|
| `CompanyTypes` | `VisaCal` |
| Engine | **API-direct** (no browser) |
| Credentials | `username`, `password` (optional `otpLongTermToken`) |
| OTP | — |
| Phase chain | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md) |
| Source | [`Banks/VisaCal/VisaCalPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  username: 'myuser',
  password: 'mypassword',
  otpLongTermToken: storedHash, // optional — the previous run's persistentOtpToken
});

storedHash = result.persistentOtpToken; // rotates on every run — always keep the latest
```

## Login

Visa Cal logs in over CAL's mobile JSON API with two POSTs and sends no SMS.
`VISACAL_API_DIRECT_CALL` (`Registry/Config/PipelineBankConfigVisaCal.ts`)
declares them:

| Step | Endpoint | Sends | Returns |
|---|---|---|---|
| `login` | `Authentication/api/login/regularLogin` | `username`, `password`, a fresh device id | session token + long-term hash |
| `resume` | `Authentication/api/login/bioLogin` | the hash | a fresh session token + a rotated hash |

`VISACAL_HEADLESS` (`Registry/Config/PipelineBankConfigVisaCalHeadless.ts`)
registers both paths on `api-cc.cal-online.co.il` and selects Node's own
`fetch` (`nativeFetch`), so no browser starts. Browser options passed to
`createScraper` are ignored with a
[warning](../configuration.md#browser-options-on-browserless-banks).

Every login response carries `statusCode`: `1` is success, `4` fails the run as
`INVALID_PASSWORD` with the message `login outcome 4`, and any other code fails
it as `GENERIC`.

## Warm start

Pass the previous run's `result.persistentOtpToken` as `otpLongTermToken` and
the run starts at `resume`, skipping the password step. The hash carries no
readable expiry, so the bank's answer is the check (`validation: 'bank-call'`);
a rejected hash falls back to a cold login with `username` and `password`,
which are therefore always required. `bioLogin` rotates the hash, so store the
new `persistentOtpToken` after every run.

## Scrape

After login every data call goes to the web gateway `api.cal-online.co.il`
with the session token as `Authorization: CALAuthScheme <token>` and CAL's web
site id (`CAL_WEB_SITE_ID`) as `x-site-id`. The `VISACAL_SHAPE`
`IApiDirectScrapeShape` (`Banks/VisaCal/scrape/VisaCalShape.ts`) declares the
calls:

- **Cards** — `account/init` lists the user's cards; each card is one account.
- **Transactions** — `getCardTransactionsDetails`, one request per card per
  billing month. CAL indexes a month by its debit date, so the walk includes
  the still-open cycle.
- **Balance** — `GetTotalFrameStatus`, one request per card. `nextTotalDebitOf`
  (`Banks/VisaCal/scrape/VisaCalShapeBalance.ts`) returns that card's
  `nextTotalDebit` as a `VisaCalNextDebit`; a confirmed reply with no frame
  for the card reports `0`. When CAL does not confirm the reply, or the
  card's figure is not a number, `balanceIsAbsent` publishes no balance and
  marks the scrape degraded. A failed frames call also publishes no balance
  for the card (`BALANCE_UNKNOWN`) and keeps its transactions. See
  [Balance resolution](../architecture/balance-resolve.md).
