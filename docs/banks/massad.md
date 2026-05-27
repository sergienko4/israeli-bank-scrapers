# Bank Massad

| | |
|---|---|
| `CompanyTypes` | `Massad` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` (plus `otpCodeRetriever` callback in options) |
| OTP | Required |
| Phase chain | INIT → HOME → LOGIN → **OTP-TRIGGER → OTP-FILL** → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
| Source | [`Banks/Massad/MassadPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Banks/Massad/MassadPipeline.ts) |

## Known quirks

- Part of the Beinleumi group — same OTP-TRIGGER + OTP-FILL flow as [Beinleumi](beinleumi.md).
- BALANCE-RESOLVE plan is single-bank-account.
