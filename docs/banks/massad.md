# Bank Massad

| | |
|---|---|
| `CompanyTypes` | `Massad` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` (plus `otpCodeRetriever` callback in options) |
| OTP | Required |
| Phase chain | INIT → HOME → LOGIN → **OTP-TRIGGER → OTP-FILL** → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE |
| Source | [`Banks/Massad/MassadPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Massad/MassadPipeline.ts) |

## Known quirks

- Part of the Beinleumi group — same OTP-TRIGGER + OTP-FILL flow as [Beinleumi](beinleumi.md).
- Post-auth uses the **hard-model** path (`withBrowserApiDirect`): after login the FIBI Mataf/appsng API is called directly (AUTH-DISCOVERY's `postLoginNav` navigates to the appsng SPA shell, replacing the generic DASHBOARD navigation). See [api-direct-scrape](../phases/api-direct-scrape.md).
- Balance plan is single bank-account (`balanceKind: 'account'`).
