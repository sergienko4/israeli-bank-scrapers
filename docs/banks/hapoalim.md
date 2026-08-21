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
the day before the oldest row returned — and repeats until a page arrives under
the cap. The brand exists so the cursor cannot be confused with the other
`YYYYMMDD` strings the shape handles.

Credit for identifying the defect and the backwards-walk remedy:
[@danielbenzvi](https://github.com/danielbenzvi).

The general form of this problem is not Hapoalim-specific — see
[coverage audit](../observability/coverage-audit.md) for the window-coverage
check that detects it on every bank.
