# Isracard

| | |
|---|---|
| `CompanyTypes` | `Isracard` |
| Engine | Browser (Pipeline) |
| Credentials | `id`, `card6Digits`, `password` |
| OTP | — |
| Phase chain | INIT → HOME → **PRE-LOGIN** → LOGIN → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
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
- BALANCE-RESOLVE uses the per-card extractor via `last4Digits` field match.
