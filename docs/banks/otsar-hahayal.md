# Bank Otsar Hahayal

| | |
|---|---|
| `CompanyTypes` | `OtsarHahayal` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` (plus `otpCodeRetriever` callback in options) |
| OTP | Required |
| Phase chain | INIT → HOME → LOGIN → **OTP-TRIGGER → OTP-FILL** → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
| Source | [`Banks/OtsarHahayal/OtsarHahayalPipeline.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/OtsarHahayal/OtsarHahayalPipeline.ts) |

## Known quirks

- Part of the Beinleumi group — same OTP-TRIGGER + OTP-FILL flow as [Beinleumi](beinleumi.md), [Massad](massad.md), [Pagi](pagi.md).
- BALANCE-RESOLVE plan is single-bank-account.
