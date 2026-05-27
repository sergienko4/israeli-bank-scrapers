# One Zero

| | |
|---|---|
| `CompanyTypes` | `OneZero` |
| Engine | **API-direct** (no browser) |
| Credentials | `email`, `password` (plus `phoneNumber`, `otpCodeRetriever`, optional `otpLongTermToken`) |
| OTP | Required (or `otpLongTermToken` from a previous run) |
| Phase chain | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md) |
| Phone format | `international-plus` (`+972000000000`) |
| Source | [`Banks/OneZero/OneZeroPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Banks/OneZero/OneZeroPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  email: 'user@example.com',
  password: 'mypassword',
  phoneNumber: '972000000000',                       // digits-only international
  otpCodeRetriever: async () => await myInbox.getCode(),
});

// Save result.persistentOtpToken — pass as otpLongTermToken on next run to skip SMS
```

## Known quirks

- GraphQL API throughout — `GET_ACCOUNT_TRANSACTIONS` + `GET_ACCOUNT_BALANCE` queries.
- Persistent OTP token returned on successful login — opt-in long-lived auth for headless re-runs.
- The poll interval was bumped past an undocumented API throttle in v8.4.x (see `fix(telegram-otp): bump poll interval past undocumented API throttle`).
