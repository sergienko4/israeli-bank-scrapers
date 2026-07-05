# Isracard

| | |
|---|---|
| `CompanyTypes` | `Isracard` |
| Engine | Browser (Pipeline) |
| Credentials | `id`, `card6Digits`, `password` |
| OTP | — |
| Phase chain | INIT → HOME → **PRE-LOGIN** → LOGIN → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE |
| Source | [`Banks/Isracard/IsracardPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Isracard/IsracardPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  id: '123456789',
  card6Digits: '123456',
  password: 'mypassword',
});
```

## Known quirks

- Mirrors the Amex flow — same two-screen PRE-LOGIN, same per-card response shape (`data.cardsList[].cardChargeNext.billingSumSekel`).
- Amex + Isracard share a sequential test group (`scripts/run-real-suite.ts` WORKER_GROUPS).
- The hard-model card-cycle path uses the per-card extractor via `last4Digits` field match.

## Hard-model post-auth

After login, Isracard uses the hard-model post-auth path (`withBrowserApiDirect`):
instead of the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE / DASHBOARD / SCRAPE /
BALANCE-RESOLVE chain, the `ISRACARD_SHAPE` `IApiDirectScrapeShape`
(`Banks/Isracard/scrape/IsracardShape.ts`) declares the exact card-list and
transactions API calls, issued directly through the live login page; balance is
card-cycle, so there is no separate balance call. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.
