# Mizrahi Bank

|                |                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Mizrahi`                                                                                                                                                        |
| Engine         | **API-direct** (no browser)                                                                                                                                      |
| Credentials    | `username`, `password`                                                                                                                                           |
| OTP            | —                                                                                                                                                                |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                            |
| Source         | [`Banks/Mizrahi/MizrahiPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Mizrahi/MizrahiPipeline.ts) |

## Quick example

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.Mizrahi,
  startDate: new Date('2024-01-01'),
});

const result = await scraper.scrape({ username: 'myuser', password: 'mypassword' });
```

## Login

Mizrahi logs in over its web app's own JSON API and sends no SMS. The login
runs on `www.mizrahi-tefahot.co.il`, then hands the session to the
online-banking host `mto.mizrahi-tefahot.co.il`. `MIZRAHI_API_DIRECT_CALL`
(`Registry/Config/PipelineBankConfigMizrahi.ts`) declares four steps:

| Step        | Endpoint                                     | Sends                                                             | Returns                                                          |
| ----------- | -------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `bootstrap` | `GET www/login/index.html`                   | —                                                                 | the `XSRF-TOKEN` cookie, set for the parent domain               |
| `login`     | `POST www/login/api/Login/LoginUser`         | `Username`, `Password`; the decoded XSRF cookie as `x-xsrf-token` | `ReturnCode`                                                     |
| `landing`   | `GET mto/Online/Default.aspx?language=he-IL` | —                                                                 | the online-banking session cookies                               |
| `logon`     | `POST mto/Online/api/SkyBL/logon`            | the app's fixed metadata                                          | `xsrfToken`, the account list and the `skyserid` response header |

The session is cookies, not an auth header. `MIZRAHI_TRANSPORT` registers the
four paths, selects Node's own `fetch` (`nativeFetch`) and keeps one cookie jar
for both hosts (`sessionCookies`, `cookieDomains`): a cookie set for the parent
domain reaches each host, a host-only cookie stays on its host. No browser
starts, and browser options passed to `createScraper` are no longer supported; see the
[migration notes](../configuration.md#removed-browser-options).

Any redirect fails the run (`redirectPolicy: 'reject'`), so a redirected
`LoginUser` never replays the credentials. The one exception is `landing`: it
follows up to three hops, and each must stay on the landing page.

The hosts and headers live in `Registry/Config/PipelineBankConfigMizrahiConstants.ts`,
shared by the login config and the scrape shape. `MIZRAHI_WEB` is the login
host and `MIZRAHI_MTO` the online-banking host; `MIZRAHI_LANDING_URL` is the
page the `landing` step loads. Every call carries `MIZRAHI_STATIC_HEADERS` (a
JSON accept and the library's user agent); the two page loads swap the accept
for `MIZRAHI_DOCUMENT_HEADERS`. A POST adds its host's origin, referer and JSON
content type: `MIZRAHI_WEB_POST_HEADERS` for `login`, `MIZRAHI_MTO_POST_HEADERS`
for `logon` and every data call.

`LoginUser` reports its result in `ReturnCode`: `1` is success, `2` fails the
run as `INVALID_PASSWORD`, `4` as `CHANGE_PASSWORD`, `5` as `ACCOUNT_BLOCKED`,
and any other value as `GENERIC` (`login outcome unmapped`). The config sets
`omitBankText`, so a `logon` reply without `xsrfToken` fails as `GENERIC`
naming the missing field only. `MIZRAHI_TRANSPORT` carries the same omission
policy into the native transport: HTTP failures from `changeAccount` and
`get428Index` keep their status but never quote bank response text. WAF
classification and its fixed reasons are preserved. Login diagnostics record
the bank's `error_code` as a length-only hint, never its raw value.

There is no long-term token: every run logs in cold, and `persistentOtpToken`
stays unset.

## Scrape

`MIZRAHI_SHAPE` (helpers under `Banks/Mizrahi/scrape/`) issues Mizrahi's exact
calls on the `mto` API:

| Step         | Call                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts     | —                          | No call: `logon` already returned `user.Accounts`. The login carries the list into the session, and the customer step (`skipFetch`) reads it from there. Every entry is scraped, keyed by its position in the array                                                                                                                                                                                                                                      |
| Balance      | POST `SkyBL/changeAccount` | `{ selectedAccountIndex }` switches the session to the account and replies with its `SnifAndNumber400` and balance `YitraAdkanit`. A reply that does not name the requested account — another account, or none at all — fails the scrape, since it cannot prove the switch landed. A `null` balance outside banking hours (about 00:00–06:00 IDT) is reported absent. A failed call fails the scrape (no `fallbackOnFail`)                               |
| Transactions | POST `SkyOSH/get428Index`  | The "between dates" (בין תאריכים) body with `DD/MM/YYYY` bank-calendar days. Only rows with `RecTypeSpecified: true` (they carry `RecType: 1`) are transactions; the balance header and section-label rows beside them are dropped. The shape declares the same test (`IS_MIZRAHI_TXN_ROW`) as `auditIsTxnRow`, so the coverage audit does not count the balance line as an unread movement. An empty `204` reply reads as no movements (`statusPolicy`) |

**Multiple accounts.** `get428Index` serves only the session's current account, the same way
the SPA's account picker works. The driver runs each account's balance step before its
transactions step, so every `get428Index` runs on the account `changeAccount` just switched to.
An unknown index still answers 200 and leaves the session unusable, so a page whose
`fields.AccountNumber` names another account fails the scrape rather than filing movements under
the wrong account. The bank names the owner only when the range reaches today: a backfill round
ending earlier, a later page and a night reply come back without `fields` (real login #14). Those
pages rely on the switch before them, because the driver finishes one account's walk, backfill
included, before it switches to the next. A data call the bank rejects (a lost session answers
`401`) fails the run; it does not log in again. The live test
account holds a single account; the two-account order, backfill rounds included, is pinned by a
unit test and by the mocked end-to-end suite, both against a simulated session.

**Auth header.** Every `mto` call needs the app's `mizrahixsrftoken` header;
one call without it ends the server session. The login composes it once, at
`logon`: the reply's `xsrfToken`, `###3`, then the `skyserid` response header
(empty when the bank sends none). `mizrahiHeaders` sends it with the `mto` POST
headers on every balance and transactions call.

**Transaction window and paging.** `get428Index` serves 365 days back from today: an older
`inFromDate` gets HTTP 500 however short the range (measured live). The start is clamped to
today − 365 days and capped at the window end (a start in the future asks for the end day alone), and older days are reported by the window-coverage audit (`windowCoverage`),
never dropped silently. The end comes from `scrapeWindowEnd`, so a backfill round narrows only
`inToDate` and keeps the floor. A backfill bound that falls before the floor (bank midnight
passed between rounds, or a row predates `inFromDate`) is lifted to the floor day, so the round
asks for that day alone instead of a start after its end, which the server also answers with
HTTP 500. When the reply adds no row older than the held one that set the bound (an empty day,
or rows inside the range), the next bound repeats and the planner refuses it
(`BOUND_DID_NOT_MOVE`); a reply straying older can move it again, and the 12-request
`MAX_BACKFILL_ASKS` ceiling still ends the loop. A page holds 50 rows; while `table.isHasMoreRows` is true, the
next page asks from the next row index and echoes the server's `actionGUID`; the shape carries
both in its `IMizrahiCursor` paging position. A page offering more rows without an `actionGUID`
fails the scrape. Later pages come back without `fields`; the `actionGUID` binds them to the
first page.

**Row position.** `get428Index` numbers its rows within each reply: `RowNumber` from 1, and
`TotalRows` is the reply's size. A backfill round re-serves the held movements of the oldest day
under new numbers. The backfill drops re-served rows by byte identity (`RawOverlap`), so the
extractor removes both keys (`withoutRowPosition`). Otherwise the round would file the same
movement twice (seen live: 3 transactions for 2). Nothing downstream reads them.

**Mapping.** The shared auto-mapper reads Mizrahi's `MC02*` keys through Well-Known aliases:
`MC02PeulaTaaEZ` (date), `MC02ErehTaaEZ` (processed date), `MC02SchumEZ` (signed amount),
`MC02TnuaTeurEZ` (description) and `MC02AsmahtaMekoritEZ` (reference). The identifier keeps
the legacy scraper's value: `withIdentifier` adds `mizrahiIdentifier` to each owned row
— `<reference>-<TransactionNumber>` when the number is set and not `1`, else the numeric
reference — so two movements sharing a reference stay distinct. A row with
`IsTodayTransaction: true` (today's movement, not yet posted) maps as `pending`; every other row
is `completed`. See [api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.

## Migration status

**Wave 1** target in the [migration plan](../architecture/migration.md). Removal and onboarding
were one migration: the change that deleted the legacy scraper also registered the Pipeline bank,
so `createScraper(CompanyTypes.Mizrahi)` never lacks a scraper. The login later moved from the
browser form to the API above, and the browser path was removed.
