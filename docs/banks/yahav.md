# Bank Yahav

|                |                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Yahav`                                                                                                                                                  |
| Engine         | **API-direct** (no browser): the mobile app's TCS **BaNCS Digital** API                                                                                  |
| Credentials    | `num`, `nationalID`, `password`; optional `otpLongTermToken` ([warm start](#warm-start))                                                                 |
| OTP            | None observed: the app's login has asked for no code                                                                                                     |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                    |
| Source         | [`Banks/Yahav/YahavPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Yahav/YahavPipeline.ts) |

## Quick example

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.Yahav,
  startDate: new Date('2024-01-01'),
});

const result = await scraper.scrape({
  num: 'myusercode', // Yahav "קוד משתמש"
  nationalID: '123456789', // "תעודת זהות"
  password: 'mypassword',
});
```

For backward compatibility the legacy key `username` is still accepted as an
alias for `num`, so `scrape({ username, nationalID, password })` keeps working.

## Login

Yahav logs in the way its Android app does, with no browser. Every call runs
on one origin, `YAHAV_NATIVE_ORIGIN` (`mobile.yahav.co.il`).
`YAHAV_API_DIRECT_CALL` (`Registry/Config/PipelineBankConfigYahav.ts`) runs
the three steps of `YAHAV_STEPS`
(`Registry/Config/PipelineBankConfigYahavSteps.ts`), on the paths in
`YAHAV_AUTH_PATHS`:

| Step       | Endpoint                          | Sends                                                                                                                                         | Returns                                                                                       |
| ---------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `prime`    | `POST /connect/client/initialize` | the app's public `YAHAV_CLIENT_ID`, a nonce, and a `device-id` derived from a fresh RSA key                                                   | the issued `client_id` and `client_secret`                                                    |
| `register` | `POST /connect/device/register`   | a certificate request over a second fresh key, naming `YAHAV_ORGANIZATION`, `YAHAV_DEVICE_NAME`, the device and the user; the user's password | the device certificate, checked against its key, `device-status: activated`, `mag-identifier` |
| `logon`    | `POST /auth/oauth/v2/token`       | over that certificate: the password grant for the user, the `YAHAV_SCOPE` scopes and the `mag-identifier`                                     | a bearer access token                                                                         |

The user every call names is `num-nationalID`. `prime` and `register` run
only on a cold login: together they enrol this run as a device of the
customer. `logon` runs on every login, and is where a [warm start](#warm-start)
resumes. The issued client credentials and the token must be printable text,
and the `mag-identifier` base64; anything else fails the step. Every call
sends `YAHAV_NATIVE_UA`, which names this library rather than the app.

`YAHAV_HEADLESS` maps each step to its path, keeps one cookie jar for
`yahav.co.il`, and presents the certificate `register` returned to the native
origin alone (`clientCert: { mode: 'dynamic' }`) over `node:https`. No browser
starts, and browser options passed to `createScraper` are ignored with a
[warning](../configuration.md#browser-options-on-browserless-banks). The
config sets `omitBankText`, so no failure message carries the bank's own text.
The credentials are checked before any call: `num` must be non-empty,
`nationalID` digits, and `password` Latin-1.

`register` carries the password, and wrong credentials draw a bare `401`
there. The reply names no reason, so the step's
[`httpFailureMap`](../phases/api-direct-call.md#http-failure-map) reports
every `401` at `register` as `INVALID_PASSWORD`, still with the message
`register HTTP 401`; any other refusal at `register` stays `GENERIC`.

## Warm start

A run that signs in returns its device as `result.persistentOtpToken`: a `v1.`
token holding the client credentials, the certificate and its private key, the
`mag-identifier` and the session cookies, bound to `num` and `nationalID`. Pass
it back as `otpLongTermToken` and the next run starts at `logon`
(`YAHAV_RESUME_STEP_INDEX`), with no new device enrolment. The token holds a
private key: store it as a secret.

The bank's answer to `logon` is the check (`validation: 'bank-call'`). Only a
`401` or `403` the bank answered falls back to one cold login
(`coldFallback: 'auth-rejected'`); a timeout, a `5xx` or a `400` fails the run
and never enrols another device. A stored token the bank keeps refusing with a
`400` is stale: drop `otpLongTermToken` once and the next run enrols afresh. A
token for another user, from another bank, too long or of the wrong shape is
skipped for a cold login; the log names the reason, never the token.

The access token is short-lived. A session lost mid-scrape signs in once more
and scrapes again (`authRecovery: 'whole-scrape'`).

## Hard-model post-auth

After login, `YAHAV_SHAPE` (`Banks/Yahav/scrape/YahavShape.ts`) declares the
exact BaNCS calls. BaNCS serves accounts, balances and transactions from **one**
route, `POST /BaNCSDigitalApp/account`, told apart by the request `Payload`;
`YAHAV_BANCS_PATHS` names it beside the login, customer and portfolio routes.

| Module                                      | Role                                                                                                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `YahavNativeEnvelope.ts`                    | `yahavLoginBody` and `yahavReadBody` (`IYahavReadBodyArgs`, `IYahavReadState`) wrap a payload in the BaNCS `MessageEnvelope`                                                                                                             |
| `YahavNativeEnvelopeStatic.ts`              | the fixed blocks, in wire order: `NATIVE_CHANNEL`, `NATIVE_VERSIONS`, `NATIVE_EMPTY_SECTOKEN` and the login payload `NATIVE_LOGIN_PAYLOAD`, naming `YAHAV_CREDENTIAL`                                                                    |
| `YahavNativeHeaders.ts`                     | `yahavNativeHeaders` (`IYahavHeaderArgs`): `YAHAV_NATIVE_HEADERS`, the call's path, the session ids and the `mag-identifier`                                                                                                             |
| `YahavNativePayloads.ts`                    | the customer and portfolio inquiries: `yahavProfilePayload`, `yahavPortfoliosPayload`, `yahavAccountsPayload`, built by `yahavInquiry` from an entity `yahavArchetype`, with `yahavPortfolioRefs` (`IYahavNativeRef`) and `ILS_CURRENCY` |
| `YahavNativePayloadsAccount.ts`             | the per-account inquiries: `yahavBalancePayload` (`IYahavAccountRefs`) and `yahavTxnsPayload` (`IYahavTxnsArgs`, `IYahavNativeDay`)                                                                                                      |
| `YahavShapeHelpers.ts`                      | `YAHAV_SESSION_KEYS`, `yahavSessionOf`, `sessionText`, `yahavPortfolioOf`, `yahavCallUrl`, `SCRAPE_LABEL` and the account type `IYahavAcct`                                                                                              |
| `YahavShapeCall.ts`                         | `yahavLoginHeaders`, `yahavReadHeaders` and `yahavReadVars`: each call's headers and body from the current session state                                                                                                                 |
| `YahavShapeSession.ts`                      | `YAHAV_RESPONSE_SESSION`, which gates and rotates the session on every answer                                                                                                                                                            |
| `YahavShapeBootstrap.ts`                    | `YAHAV_BOOTSTRAP`: the BaNCS `login`, the `profile` read and the `portfolio` read                                                                                                                                                        |
| `YahavAccountExtract.ts`                    | `extractYahavAccounts`, `countYahavAccounts`, `isYahavAccountOf`, `yahavEntities` and `yahavRefOf`                                                                                                                                       |
| `YahavShapeAccounts.ts`                     | `YAHAV_CUSTOMER` and `YAHAV_BALANCE`, posting to `YAHAV_ACCOUNT_URL` with `YAHAV_ACCOUNT_HEADERS`                                                                                                                                        |
| `YahavShapeChunks.ts` / `YahavShapeTxns.ts` | the month plan (`scrapeChunks`, `chunkAt`, `validatePlan`, `yahavDayOf`) and `YAHAV_TXNS`                                                                                                                                                |

**Envelope.** Every call posts a `MessageEnvelope` carrying the app's versions,
`YAHAV_APP_VER`, `YAHAV_API_VER` and `YAHAV_ENVELOPE_VER`, and a `MsgId` and
`TimeStamp` taken from one instant. The timestamp carries the instant's UTC
calendar and clock under the offset Asia/Jerusalem has at that instant,
whatever the host zone. The BaNCS login sends an empty security token and no
CSRF token; it rides the bearer token, never the password. Each read replays the
last security token and adds the CSRF token before its payload.

**Body digest.** `YAHAV_BODY_DIGEST` signs every body: the `BD_IDENT_KEY`
header is the base64 of `AppVer~APIVer~EnvVer~` and the SHA-256 hex of the exact
bytes sent. Key order is part of those bytes, so every block is declared in the
order the app sends it.

**Session.** BaNCS rotates its security token, CSRF token and two session ids
on every answer. `YAHAV_RESPONSE_SESSION` reads them from each answer into the
session-context under `YAHAV_SESSION_KEYS`; a value an answer leaves out or
sends empty keeps the previous one, as the app does (`profile` answers with
both session headers empty). A value that is not printable text fails the call,
as does an answer after which any of the four is still missing — the login
included. An answer is accepted on HTTP 200, the envelope version, a zero
status code and a payload; an empty answer, such as a month without movements,
leaves `DataEntity` out and reads as no rows.

**Bootstrap.** `login` opens the BaNCS session, `profile` proves the customer
(an answer without a `CustomerUser` fails the run), and `portfolio` picks the
default portfolio, else the first, which every later read names.

**Accounts and balance.** `YAHAV_CUSTOMER` lists the portfolio's accounts and
keeps every current (`DDA`) account in ILS. An account is matched by its id;
when both the account and the answer carry an account number, the two must
agree (an empty number counts as none, since the reads send one empty). The IOR
id is ignored because the bank re-issues it between reads. `YAHAV_BALANCE` reads the matched account's
`CURRENT` figure (`balanceKind: ACCOUNT`). A missing or non-numeric figure is
reported absent, never coerced to zero, and a failed balance read fails the
scrape.

**Transactions.** `YAHAV_TXNS` walks the scrape window a month at a time, one
request per month, so a wide range never relies on BaNCS honouring one wide
query. A start after the window end falls back to the end's bank day, and an
invalid or oversized plan is refused before any request is built. A page keeps
only the rows that name the account; a row naming another account is left
unread, and the [coverage audit](../observability/coverage-audit.md) reports
it as a shortfall. Kept rows are flattened by `normalizeBancsRecords`
(`Mediator/Scrape/Bancs/BancsNormalizer.ts`). The window end reaches the
request (`windowNarrowing: 'windowEnd'`). See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.

## Known quirks

- **The phone app may sign out.** `register` sends
  `enable-multi-device-login: false`, as the app does. Enrolling this library as
  a device may sign the customer's phone app out; signing in on the phone again
  enrols the phone afresh. Keep the warm token so a run enrols only when it must.
- **Each cold login enrols a device.** A run without a usable warm token
  registers a new device with the bank. The warm token avoids that, and only a
  `401`/`403` on `logon` starts a new enrolment.
- **Pinned app versions.** The versions the envelope reports and the digest
  covers are pinned in `Registry/Config/PipelineBankConfigYahavConstants.ts`.
  If the bank retires that app build, update them there; nothing else names
  them.
- **History depth is unproven.** The month walk has been checked over the
  default window; how far back BaNCS answers is not.
