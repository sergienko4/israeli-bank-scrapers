# Discount Bank

| | |
|---|---|
| `CompanyTypes` | `Discount` |
| Engine | Browser (Pipeline) |
| Credentials | `id`, `password`, `num` |
| OTP | — |
| Phase chain | INIT → HOME → LOGIN → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
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
- BALANCE-RESOLVE plan is per-bank-account — Discount customers usually have one BA, but the planner handles multi-BA accounts identically.
- The PayBox wallet uses Discount's infrastructure but ships as a separate api-direct bank — see [PayBox](paybox.md).
