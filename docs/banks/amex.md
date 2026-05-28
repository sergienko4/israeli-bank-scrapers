# Amex (American Express)

| | |
|---|---|
| `CompanyTypes` | `Amex` |
| Engine | Browser (Pipeline) |
| Credentials | `id`, `card6Digits`, `password` |
| OTP | — |
| Phase chain | INIT → HOME → **PRE-LOGIN** → LOGIN → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
| Source | [`Banks/Amex/AmexPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Amex/AmexPipeline.ts) |

## Quick example

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.Amex,
  startDate: new Date('2024-01-01'),
});

const result = await scraper.scrape({
  id: '123456789',
  card6Digits: '123456',
  password: 'mypassword',
});
```

## Known quirks

- Two-screen login — the **PRE-LOGIN** phase clicks "המשך עם סיסמה" (continue with password) before the password field becomes visible.
- Per-card response shape — `data.cardsList[].cardChargeNext.billingSumSekel`. BALANCE-RESOLVE's per-card extractor handles this via the `last4Digits` field match.
- Amex + Isracard share a sequential test group (`scripts/run-real-suite.ts` WORKER_GROUPS) — Amex must finish before Isracard logs in on the same customer-side session.
