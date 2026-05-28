# Bank Pagi

| | |
|---|---|
| `CompanyTypes` | `Pagi` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` (plus `otpCodeRetriever` callback in options) |
| OTP | Required |
| Phase chain | INIT → HOME → LOGIN → **OTP-TRIGGER → OTP-FILL** → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
| Source | [`Banks/Pagi/PagiPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Pagi/PagiPipeline.ts) |

## Known quirks

- Part of the Beinleumi group — same OTP-TRIGGER + OTP-FILL flow.
- BALANCE-RESOLVE plan is single-bank-account.
