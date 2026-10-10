# Mizrahi Bank

!!! warning "Not production-ready yet"
    The Pipeline bank replaced the legacy (non-Pipeline) Mizrahi scraper in one
    change: `createScraper` routes `CompanyTypes.Mizrahi` to the Pipeline, but the bank is not
    production-ready yet: the login and the hard-model scrape are still being
    proven by real runs.

| | |
|---|---|
| `CompanyTypes` | `Mizrahi` |
| Engine | Browser (Pipeline) — **not production-ready yet** |
| Credentials | `username`, `password` |
| OTP | — |

## Login

**Login is zero-config.** `MIZRAHI_LOGIN` ships **empty selector arrays** — `SelectorResolver`
matches the `username`/`password` inputs and submit button from the generic Well-Known login
candidates (visible text), per the repo's ZERO-CSS-selectors rule. The login wiring is only
`.withBrowser()` + `.withDeclarativeLogin(MIZRAHI_LOGIN)`, so there is no PRE-LOGIN and no OTP. HOME clicks **כניסה לחשבון**, which opens a modal whose same-origin iframe
(`/login/index.html`) holds the credential form.

## Hard-model post-auth

After login, `buildMizrahiPipeline` adds `.withBrowserApiDirect(MIZRAHI_SHAPE)`, so the chain is
INIT → HOME → LOGIN → AUTH-DISCOVERY → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE.
`MIZRAHI_SHAPE` (helpers under `Banks/Mizrahi/scrape/`) issues Mizrahi's exact calls on the
`mto.mizrahi-tefahot.co.il` API through the live page:

| Step | Call | Notes |
|---|---|---|
| Accounts | POST `SkyBL/logon` | Static body. Every entry of `Accounts[]` is scraped, keyed by its position in the array |
| Balance | POST `SkyBL/changeAccount` | `{ selectedAccountIndex }` switches the session to the account and replies with its `SnifAndNumber400` and balance `YitraAdkanit`. A reply that does not name the requested account — another account, or none at all — fails the scrape, since it cannot prove the switch landed. A `null` balance outside banking hours (about 00:00–06:00 IDT) is reported absent. A failed call fails the scrape (no `fallbackOnFail`) |
| Transactions | POST `SkyOSH/get428Index` | The "between dates" (בין תאריכים) body with `DD/MM/YYYY` bank-calendar days. Only rows with `RecTypeSpecified: true` (they carry `RecType: 1`) are transactions; the balance header and section-label rows beside them are dropped. The shape declares the same test (`IS_MIZRAHI_TXN_ROW`) as `auditIsTxnRow`, so the coverage audit does not count the balance line as an unread movement |

**Multiple accounts.** `get428Index` serves only the session's current account, the same way
the SPA's account picker works. The driver runs each account's balance step before its
transactions step, so every `get428Index` runs on the account `changeAccount` just switched to.
An unknown index still answers 200 and leaves the session unusable, so a page whose
`fields.AccountNumber` names another account fails the scrape rather than filing movements under
the wrong account. The bank names the owner only when the range reaches today: a backfill round
ending earlier, a later page and a night reply come back without `fields` (real login #14). Those
pages rely on the switch before them, because the driver finishes one account's walk, backfill
included, before it switches to the next. The browser-bound API mediator has no token resolver,
so a rejected call is never replayed on a reset session; it fails the scrape. The live test
account holds a single account; the two-account order, backfill rounds included, is pinned by a
unit test against a simulated session.

**Auth header.** Every `mto` call needs the SPA's `mizrahixsrftoken` header; one call without it
ends the server session. The config opts into the discovered-header bag
(`installDiscoveredHeaders`, scoped by `discoveredHeadersUrlMatch` to the `mto` host), and the
`/get428Index/i` pattern in `ScrapeWK.ts` makes the landing page's own `get428Index` request the
header donor. There is no `postLoginNav`: a deep link loses the session.

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
are one migration: the change that deleted the legacy scraper also registered the Pipeline bank
(login form plus the hard-model API-direct scrape), so `createScraper(CompanyTypes.Mizrahi)` never
lacks a scraper. Real runs prove each phase before the bank is marked production-ready.
