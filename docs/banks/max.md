# Max (formerly Leumi Card)

| | |
|---|---|
| `CompanyTypes` | `Max` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` |
| OTP | — |
| Phase chain | INIT → HOME → **PRE-LOGIN** → LOGIN → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE |
| Source | [`Banks/Max/MaxPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Max/MaxPipeline.ts) |

## Known quirks

- All Max selectors were migrated from CSS/IDs to **visible Hebrew text** in v8.2.0.
- Max + Isracard + Amex are the three credit-card brands with PRE-LOGIN.
- Balance is card-cycle (`balanceKind: CARD_CYCLE`) — derived from the billing cycle by the hard-model path, not a separate per-account balance call.

## Hard-model post-auth

After login, Max uses the hard-model post-auth path
(`withBrowserApiDirect`): the exact API calls are issued directly through the
live login page instead of the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE /
DASHBOARD / SCRAPE / BALANCE-RESOLVE chain. The bank's `IApiDirectScrapeShape`
(card-list and transactions helpers under `Banks/Max/scrape/`: `extractCards`,
`customerUrl`, `txnsUrl` / `txnsExtractPage`) declares each endpoint; balance is
card-cycle, so there is no separate balance call. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.

