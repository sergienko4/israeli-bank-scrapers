# Isracard

|                |                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Isracard`                                                                                                                                                           |
| Engine         | **API-direct** (no browser)                                                                                                                                          |
| Credentials    | `id`, `card6Digits`, `password` (optional `otpLongTermToken`)                                                                                                        |
| OTP            | —                                                                                                                                                                    |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                                |
| Source         | [`Banks/Isracard/IsracardPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Isracard/IsracardPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  id: '123456789',
  card6Digits: '123456',
  password: 'mypassword',
  otpLongTermToken: storedKey, // optional — the previous run's persistentOtpToken
});

storedKey = result.persistentOtpToken; // the same key every run — keep it
```

## Login

Isracard logs in over its ring mobile gateway, `ring.isracard.co.il`, and sends
no SMS. Every login step POSTs to the one `service` endpoint and names its bank
service in the query string. `ISRACARD_API_DIRECT_CALL`
(`Registry/Config/PipelineBankConfigIsracard.ts`) builds the steps from
Isracard's ring constants (`ISRACARD_RING`):

| Step           | Bank service               | Sends                               | Returns                             |
| -------------- | -------------------------- | ----------------------------------- | ----------------------------------- |
| `validate`     | `ValidateIdDataNoReg`      | `id`, `card6Digits`                 | the session's `bcKey` and user code |
| `login`        | `performNewLogon`          | `id`, the user code, `password`     | —                                   |
| `deviceKey`    | `CustomerValidateKeyOtp`   | `id`, `card6Digits`, the device id  | a device key                        |
| `register`     | `CustomerDataRegistration` | `id`, the device key, the device id | —                                   |
| `resume`       | `CustomerValidateKeyOtp`   | the device key, the device id       | the session's `bcKey` and user code |
| `sessionToken` | `performLogonOtp`          | `id`, the user code                 | —                                   |

`sessionToken` and the card list both send the app's wallet id,
`RING_WALLET_ID`.

The device id is derived from `id`, so every run of one user presents the same
device. `ISRACARD_TRANSPORT` registers the `service` URL and selects Node's own
`fetch` (`nativeFetch`) with a cookie jar, so no browser starts. Browser
options passed to `createScraper` are no longer supported; see the
[migration notes](../configuration.md#removed-browser-options).

`validate` succeeds on `returnCode` `1`; `4` fails the run as
`CHANGE_PASSWORD`. `login` succeeds on `Header.Status` `1`; `3` fails it as
`CHANGE_PASSWORD`. Any other code fails as `INVALID_PASSWORD` with the message
`<step> outcome unmapped` — a wrong password ends at `login` this way. The code
itself is never logged.

## Warm start

Pass the previous run's `result.persistentOtpToken` as `otpLongTermToken` and
the run starts at `resume`, skipping the password. The key carries no readable
expiry, so the bank's answer is the check (`validation: 'bank-call'`); a
rejected key falls back to a cold login with `id`, `card6Digits` and
`password`, which are therefore always required. The key does not rotate: a
warm run returns the key it was given.

## Scrape

The `ISRACARD_SHAPE` `IApiDirectScrapeShape`
(`Banks/Isracard/scrape/IsracardShape.ts`) is built by the shared ring
factory; see [the Ring family](../phases/api-direct-scrape.md#the-ring-family-isracard-and-amex).

- **Cards** — `CardsList_102Digital` lists the user's cards; each card is one
  account, numbered by its last four digits. A row without a four-digit card
  number means the list cannot be trusted, so the run fails rather than
  omit that card's money.
- **Transactions** — GatewayV2 `GetTransactionsList`, one request per card per
  billing month. Rows from all three voucher containers are merged. A month
  the bank does not confirm fails the run; it is never read as empty.
- **Balance** — the same call for the card's next debit month: the statement
  total is the card's next debit, and a month with no charges is `0`. A card
  with no payment day, a statement with no readable total, or a reply the bank
  did not confirm publishes no balance and marks the scrape degraded. See
  [Balance resolution](../architecture/balance-resolve.md).

## Known quirks

- Amex + Isracard share a sequential test group (`scripts/run-real-suite.ts` WORKER_GROUPS).
- Every ring reply carries the bank's verdict inside an HTTP 200:
  `Header.Status` on the `service` endpoint, `isSuccess` on GatewayV2. The
  shape fails any call the bank did not confirm, with a fixed message that
  never echoes the bank's code. An expired session (`Header.Status -2`) fails
  the same way, so a warm run re-logs in once.
- A card with no payment day has no known next-debit month, so it publishes no
  balance and the scrape is degraded. On a warm run that triggers the one
  recovery re-login: the run logs in cold and scrapes again. The result is the
  same; the run takes longer.
