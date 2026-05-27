# Bank Hapoalim

| | |
|---|---|
| `CompanyTypes` | `Hapoalim` |
| Engine | Browser (Pipeline) |
| Credentials | `userCode`, `password` (plus `otpCodeRetriever` callback in options) |
| OTP | **Conditional** — only on unrecognised devices |
| Phase chain | INIT → HOME → LOGIN → (OTP-FILL conditional) → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
| Source | [`Banks/Hapoalim/HapoalimPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Banks/Hapoalim/HapoalimPipeline.ts) |

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
- BALANCE-RESOLVE plan is single-bank-account (one entry) — the bank exposes a single `bankAccountUniqueId` per customer.
