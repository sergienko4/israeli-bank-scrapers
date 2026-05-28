# Beinleumi (FIBI)

| | |
|---|---|
| `CompanyTypes` | `Beinleumi` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` (plus `otpCodeRetriever` callback in options) |
| OTP | Required |
| Phase chain | INIT → HOME → LOGIN → **OTP-TRIGGER → OTP-FILL** → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
| Source | [`Banks/Beinleumi/BeinleumiPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Beinleumi/BeinleumiPipeline.ts) |

## Quick example

```typescript
const scraper = createScraper({
  companyId: CompanyTypes.Beinleumi,
  startDate: new Date('2024-01-01'),
  otpCodeRetriever: async phoneHint => await myInbox.getSmsCode(phoneHint),
});

const result = await scraper.scrape({
  username: 'myuser',
  password: 'mypassword',
});
```

## Known quirks

- Beinleumi is the parent of the Beinleumi group: same login flow used by Massad, Otsar Hahayal, Pagi.
- Balance endpoint shape: `(withdrawable + current)` per account — see [`beinleumi/balance-resolve/last-good.json`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Tests/Unit/Pipeline/CrossValidation/Phases/Fixtures/beinleumi/balance-resolve/last-good.json) for the captured response shape.
