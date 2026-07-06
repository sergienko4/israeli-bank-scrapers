# Visa Cal

| | |
|---|---|
| `CompanyTypes` | `VisaCal` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` |
| OTP | — |
| Phase chain | INIT → HOME → **PRE-LOGIN** → LOGIN → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE |
| Source | [`Banks/VisaCal/VisaCalPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.ts) |

## Known quirks

- **Per-card nested response shape** — `result.bigNumbers[].cards[]`. The hard-model per-card extractor walks `cardUniqueId` matches inside this nested structure.
- A single Visa Cal customer can have **multiple bank accounts × multiple cards per BA**. The hard-model transactions step issues one request per unique `bankAccountUniqueId`, then re-attributes the per-card values from each response.
- Balance is card-cycle (`balanceKind: CARD_CYCLE`) — the billing values come from each card's response, with no separate per-account balance call.

## Hard-model post-auth

After login, Visa Cal uses the hard-model post-auth path (`withBrowserApiDirect`):
instead of the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE / DASHBOARD / SCRAPE /
BALANCE-RESOLVE chain, the `VISACAL_SHAPE` `IApiDirectScrapeShape`
(`Banks/VisaCal/scrape/VisaCalShape.ts`) declares the exact card-list and
transactions API calls, issued directly through the live login page; balance is
card-cycle, so there is no separate balance call. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.
