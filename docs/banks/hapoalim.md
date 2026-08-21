# Bank Hapoalim

| | |
|---|---|
| `CompanyTypes` | `Hapoalim` |
| Engine | Browser (Pipeline) |
| Credentials | `userCode`, `password` (plus `otpCodeRetriever` callback in options) |
| OTP | **Conditional** — only on unrecognised devices |
| Phase chain | INIT → HOME → LOGIN → (OTP-FILL conditional) → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE |
| Source | [`Banks/Hapoalim/HapoalimPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Hapoalim/HapoalimPipeline.ts) |

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

## Known quirks

- Hapoalim uses **OTP-FILL only**, never OTP-TRIGGER — the bank auto-sends the code when it decides a device is unrecognised.
- On remembered devices, the OTP form simply doesn't appear and the `otpCodeRetriever` is never invoked.
- Balance is single-bank-account (`balanceKind: ACCOUNT`) — the bank exposes a single `bankAccountUniqueId` per customer, resolved by the hard-model balance step.

## Hard-model post-auth

After login, Hapoalim uses the hard-model post-auth path (`withBrowserApiDirect`):
instead of the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE / DASHBOARD / SCRAPE /
BALANCE-RESOLVE chain, the `HAPOALIM_SHAPE` `IApiDirectScrapeShape`
(`Banks/Hapoalim/scrape/HapoalimShape.ts`) declares the exact accounts, balance,
and transactions API calls, issued directly through the live login page. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.

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
[coverage backfill](../phases/api-direct-scrape.md#coverage-backfill--asking-again-for-the-slice-that-did-not-arrive),
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
