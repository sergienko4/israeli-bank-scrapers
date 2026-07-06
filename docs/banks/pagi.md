# Bank Pagi

| | |
|---|---|
| `CompanyTypes` | `Pagi` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` (plus `otpCodeRetriever` callback in options) |
| OTP | Required |
| Phase chain | INIT → HOME → LOGIN → **OTP-TRIGGER → OTP-FILL** → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE |
| Source | [`Banks/Pagi/PagiPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Pagi/PagiPipeline.ts) |

## Known quirks

- Part of the Beinleumi group — same OTP-TRIGGER + OTP-FILL flow.
- Balance is single-bank-account (`balanceKind: ACCOUNT`), resolved by the hard-model balance step.

## Hard-model post-auth

After login, Pagi uses the hard-model post-auth path (`withBrowserApiDirect`):
instead of the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE / DASHBOARD / SCRAPE /
BALANCE-RESOLVE chain, the `PAGI_SHAPE` `IApiDirectScrapeShape`
(`Banks/Pagi/scrape/PagiShape.ts`) declares the exact accounts, balance, and
transactions API calls, issued directly through the live login page.
AUTH-DISCOVERY's cross-origin `postLoginNav` navigates to the appsng SPA shell
(`/appsng/Resources/PortalNG/shell/#/accountSummary`) first, minting the
online-origin session so the cookie-authed fetches don't fire on a blank page.
See [api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.
