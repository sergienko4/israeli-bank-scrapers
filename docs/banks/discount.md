# Discount Bank

| | |
|---|---|
| `CompanyTypes` | `Discount` |
| Engine | Browser (Pipeline) |
| Credentials | `id`, `password`, `num` |
| OTP | — |
| Phase chain | INIT → HOME → LOGIN → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE |
| Source | [`Banks/Discount/DiscountPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Discount/DiscountPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  id: '123456789',
  password: 'mypassword',
  num: '12345',
});
```

## Known quirks

- Three-field login — the third `num` field is the Discount-specific account number.
- Balance is per-bank-account (`balanceKind: ACCOUNT`) — Discount customers usually have one BA, but the hard-model balance step handles multi-BA accounts identically.
- The PayBox wallet uses Discount's infrastructure but ships as a separate api-direct bank — see [PayBox](paybox.md).

## Hard-model post-auth

After login, Discount uses the hard-model post-auth path (`withBrowserApiDirect`):
instead of the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE / DASHBOARD / SCRAPE /
BALANCE-RESOLVE chain, the `DISCOUNT_SHAPE` `IApiDirectScrapeShape`
(`Banks/Discount/scrape/DiscountShape.ts`) declares the exact accounts, balance,
and transactions API calls, issued directly through the live login page. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.
