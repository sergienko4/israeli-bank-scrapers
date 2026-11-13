# Bank Hapoalim

|                |                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Hapoalim`                                                                                                                                                           |
| Engine         | **API-direct** (no browser)                                                                                                                                          |
| Credentials    | `userCode`, `password`, plus an `otpCodeRetriever` callback; optional `otpLongTermToken` ([warm start](#warm-start))                                                 |
| OTP            | **Conditional**: an SMS code, only when the bank asks for one                                                                                                        |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                                |
| Source         | [`Banks/Hapoalim/HapoalimPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Hapoalim/HapoalimPipeline.ts) |

## Quick example

```typescript
const scraper = createScraper({
  companyId: CompanyTypes.Hapoalim,
  startDate: new Date('2024-01-01'),
  otpCodeRetriever: async phoneHint => await myInbox.getSmsCode(phoneHint),
});

const result = await scraper.scrape({
  userCode: '1234567',
  password: 'mypassword',
});
```

The retriever may also be passed in the credentials, beside `userCode` and
`password`. Either way it receives the masked phone number the bank texted and
must answer the five-digit code.

## Login

Hapoalim logs in over its login page's own API, with no browser. Every call
runs on one origin, `HAPOALIM_ORIGIN` (`login.bankhapoalim.co.il`).
`HAPOALIM_API_DIRECT_CALL` (`Registry/Config/PipelineBankConfigHapoalim.ts`)
runs the seven steps of `HAPOALIM_STEPS`
(`Registry/Config/PipelineBankConfigHapoalimSteps.ts`):

| Step           | Endpoint                              | Sends                                                          | Returns                                                       |
| -------------- | ------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `identify`     | `GET /authenticate/init`              | `?appId=…&mobile=ca`                                           | the WAF handshake cookies; a 302 is accepted as the answer    |
| `verify`       | `POST /authenticate/verify`           | the password in `credentials`, and `mfp` = the device signature | `state`: `LOGONOTP` when an SMS is needed, `LANDPAGE` when not; `result.deviceID`; `result.reason` |
| `otpInit`      | `POST /authenticate/logonotp/init`    | asks for the SMS                                               | the masked phone number, passed to the retriever              |
| `otpVerify`    | `POST /authenticate/logonotp/verify`  | the code, the flow and state, and the CSRF cookie              | `state`: `LANDPAGE`                                           |
| `step1`        | `GET /ServerServices/step1-mobile`    | the app device parameters                                      | the device registration cookie                                |
| `arcotid`      | `POST /arcotid/download`              | `IMPDEVREG` / `FINISH`                                         | a 302 to the step-up on a new device                          |
| `stepupInit`   | `POST /stepup/otp/init`               | `IMPDEVREG` / `STEPUPOTP`                                      | the masked phone for the second SMS                           |
| `stepupVerify` | `POST /stepup/otp/verify`             | the second code                                               | `state`: `FINISH`                                             |
| `arcotidAfter` | `POST /arcotid/download`              | `IMPDEVREG` / `FINISH`                                         | `result.arcotID`                                              |

The app edge is `iphone.bankhapoalim.co.il`; every call carries `appId`,
the app version headers and the captured RiskMinder **device signature** as
`mfp`. The password travels in clear in `credentials` (the app's own CA
contract; there is no portal RSA seal).

A **registered device** answers `verify` with `LANDPAGE`, and the retriever is
never called. A **new device** answers `LOGONOTP` (`reason=newDevice`): the
login SMS runs first, then `step1`, `arcotid`, the **second** step-up SMS
(`stepupInit`/`stepupVerify`) and the Arcot download. A brand-new device
therefore asks for two codes; a registered one asks for none (or one when the
session itself needs a fresh login). The step-up hook uses `reuse: 'per-step'`
so the second code is a distinct acquisition.

`verify` and `otpVerify` read the reply's `state` regardless of case. `LOCKED`
and `DISABLED` fail the run as `ACCOUNT_BLOCKED`, and `REISSUE` as
`CHANGE_PASSWORD`. Any other `verify` state fails as `GENERIC`
(`verify outcome unmapped`), and any other `otpVerify` state as `INVALID_OTP`.
A reply carrying any pointer in `HAPOALIM_ERRORS` (`error`, `Error`,
`errors`) fails its step as `GENERIC` (`<step> bank error`). A `target` the
bank points at must be one of the portal pages in `HAPOALIM_TARGETS`. The
config sets `omitBankText`, so no failure message carries the bank's own
text or a foreign URL.

Every call carries `HAPOALIM_STATIC_HEADERS`: a JSON accept, the library's user
agent and the login page as referer. The page load swaps the accept for
`HAPOALIM_DOCUMENT_HEADERS`. Every POST adds `HAPOALIM_POST_HEADERS`: the
origin, and the `XSRF-TOKEN` cookie echoed as `x-xsrf-token`.
`literalHeaders` (`Registry/Config/PipelineBankConfigLiteralHeaders.ts`,
shared with Mizrahi) turns these fixed maps into step headers.

The session is cookies, not an auth header. `HAPOALIM_TRANSPORT` maps each step
to its path, selects Node's own `fetch` (`nativeFetch`) and keeps one cookie jar
for `bankhapoalim.co.il` (`sessionCookies`, `cookieDomains`). No browser
starts, and browser options passed to `createScraper` are no longer supported; see the
[migration notes](../configuration.md#removed-browser-options). Any
redirect fails the run (`redirectPolicy: 'reject'`), so a redirected `verify`
never replays the sealed password.

## Warm start

A run that signs in returns its session as `result.persistentOtpToken`: a
`v1.` token holding the session cookies, bound to the user code. Pass it back
as `otpLongTermToken` and the next run starts at `landing`
(`HAPOALIM_RESUME_STEP_INDEX`), with no login call and no SMS. The token is a
live session: store it as a secret.

The cookies carry no readable expiry, so the bank's answer to `landing` is the
check (`validation: 'bank-call'`). A refused session falls back to one cold
login that sends none of the stored cookies and texts one SMS, so `userCode`,
`password` and the retriever stay required. A token for another user code,
from another bank, longer than `MAX_ACCESS_TOKEN_CHARS` or of the wrong shape
is skipped for a cold login; the log names the reason, never the token.

A warm session lost mid-scrape signs in cold once and scrapes again, like any
API-direct bank. That login is the run's only SMS. A cold run that loses its
session mid-scrape fails, and the next run logs in again.

### Device-bound login (zero SMS, no expiry window)

The app also carries a **RiskMinder device signature** that the bank accepts
as a known device. Sent as the `mfp` form field on `authenticate/verify`, it
turns the login straight into `LANDPAGE` — no `LOGONOTP`, no SMS — and it is
not tied to the 10–15 minute session cookie.

- Source on a live app install:
  `shared_prefs/com.ca.mobile.riskminder.RmDeviceID.xml`, key `rmDeviceID`
  (about 1,942 characters, a JSON device signature).
- Send it as `mfp`; `authType` may be `TOUCHID` or empty.
- It is a device/account credential: store it like a refresh token (0600),
  never in the repo. Re-enrolling a device yields a new value.

This is the app's own real attestation captured from the device, not a
synthesised value. Two SMS on a brand-new device are expected (new-device
login, then `IMPDEVREG` device validation); with the signature there are none.

## Known quirks

- Balance is single-bank-account — the bank exposes a single `bankAccountUniqueId` per customer, resolved by the hard-model balance step.

## Hard-model post-auth

After login, the `HAPOALIM_SHAPE` `IApiDirectScrapeShape`
(`Banks/Hapoalim/scrape/HapoalimShape.ts`) declares the exact accounts,
balance and transactions calls, sent on the login's cookie jar under
`HAPOALIM_API`. Each carries the static headers. The transactions POST also
sends the POST headers, the `HAPOALIM_TXNS_CONTENT_TYPE` content type, a fresh
`uuid` and the page's `pageUuid`, with an empty JSON array as its body. An empty
`204` reply reads as no movements; a partial `203`, `206` or `207` reply fails
the run rather than reading as complete. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.

## Transaction sign

Hapoalim sends `eventAmount` as an **unsigned magnitude** and states the
direction separately, in the numeric `eventActivityTypeCode`. Nothing in the
amount says which way the money moved, so a mapper that reads only the value
reports an outbound payment as income.

The mapper therefore drives an outbound row's charged amount negative and takes
an inbound row's as an absolute value. The code is authoritative — it is an
explicit statement by the bank, so it outranks the worded `debit`/`credit`
direction the generic reader falls back on. The two code values are registered
once, in the
[registered direction codes](../architecture/transaction-sign.md#registered-direction-codes)
table; that page also carries the full resolution order and the reasons the code
is read on the record root only, with strict numeric equality.

## Truncated transaction windows

Hapoalim's transactions endpoint serves at most `numItemsPerPage` rows (150 in
captured traffic) and offers **no next-page link, cursor or offset** to fetch the
rest. A busy account therefore receives a silently short answer: the response is
well-formed, every row in it is read, and the missing weeks are indistinguishable
from a quiet month. A real account lost four weeks of history this way.

Because the bank exposes no way to ask for "the next page", the only way to reach
the older rows is to ask for an **earlier window**. `HapoalimShapeTxns.ts` walks
backwards: when a page comes back at the declared cap it mints a
`HapoalimCursor` — the branded `retrievalEndDate` for the next request, set to
**the oldest day the page returned, inclusive** — and repeats until a page
arrives under the cap. The brand exists so the cursor cannot be confused with
the other `YYYYMMDD` strings the shape handles.

The bound is inclusive rather than "the day before the oldest row" because the
cap is a **row count, not a day boundary**: a day busy enough to fill the page
is cut mid-day, and excluding it would drop every remaining row on it with no
trace. Re-asking for that same day re-serves the rows already held, so the shape
declares `pagesMayOverlap`, and the paginator's merge spends one held copy per
re-served row — leaving exactly the rows the cap withheld. The walk still
terminates: if a re-ask yields nothing new the oldest day is unchanged, the
bound repeats, and the paginator's cursor-repeat guard stops it. The one case it
cannot narrow — a single day holding more rows than the page cap — is reported
rather than silently truncated.

Only a token of exactly eight digits is accepted as a date. A malformed one
(`0`, an empty string, an ISO date) would win the lexicographic minimum against
every real `YYYYMMDD` value, and the walk would read the resulting bound as
"already past the requested start" and stop — losing the rest of the window
silently, which is the failure class this whole mechanism exists to remove.

Credit for identifying the defect and the backwards-walk remedy:
[@danielbenzvi](https://github.com/danielbenzvi).

Two mechanisms now answer this defect, and both are kept. The shape walk above
is the more precise of the two, because it reads the cap the bank itself
states rather than inferring truncation after the fact — so it never spends a
probe request on an account that was simply quiet. Beneath it sits the generic
[coverage backfill](../phases/api-direct-scrape.md#coverage-backfill-asking-again-for-the-slice-that-did-not-arrive),
which watches the rows that survive the walk and narrows the window again if
they still fall short. They compose rather than compete: once the shape walk
has reached the requested start the window assesses as covered, so the generic
loop asks for nothing. `HapoalimBackfillComposition.test.ts` runs the real
extractor against a stand-in bank that caps like the real one and asserts
exactly that — and, given only the first page, that both paths independently
derive the same next bound.

The general form of this problem is not Hapoalim-specific — see
[coverage audit](../observability/coverage-audit.md) for the window-coverage
check that detects it on every bank.
