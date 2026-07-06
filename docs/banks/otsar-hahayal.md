# Bank Otsar Hahayal

| | |
|---|---|
| `CompanyTypes` | `OtsarHahayal` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` (plus `otpCodeRetriever` callback in options) |
| OTP | Required |
| Phase chain | INIT → HOME → LOGIN → **OTP-TRIGGER → OTP-FILL** → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE |
| Source | [`Banks/OtsarHahayal/OtsarHahayalPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/OtsarHahayal/OtsarHahayalPipeline.ts) |

## Known quirks

- Part of the Beinleumi group — same OTP-TRIGGER + OTP-FILL flow as [Beinleumi](beinleumi.md), [Massad](massad.md), [Pagi](pagi.md).
- Balance is single-bank-account (`balanceKind: ACCOUNT`), resolved by the hard-model balance step.

## Hard-model post-auth

After login, Otsar Hahayal uses the hard-model post-auth path
(`withBrowserApiDirect`): instead of the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE
/ DASHBOARD / SCRAPE / BALANCE-RESOLVE chain, the `OTSAR_HAHAYAL_SHAPE`
`IApiDirectScrapeShape` (`Banks/OtsarHahayal/scrape/OtsarHahayalShape.ts`)
declares the exact accounts, balance, and transactions API calls, issued
directly through the live login page. A post-login `prime` nav to the appsng
SPA shell (`/appsng/Resources/PortalNG/shell/#/accountSummary`) forces FIBI's
`/wps/` portal shell into the Angular app context first, so the cookie-authed
fetches don't fire on a blank page. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.
