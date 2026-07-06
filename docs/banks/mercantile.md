# Mercantile Bank

| | |
|---|---|
| `CompanyTypes` | `Mercantile` |
| Engine | Browser (Pipeline) |
| Credentials | `id`, `password`, `num` |
| OTP | — |
| Phase chain | INIT → HOME → LOGIN → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE |
| Source | [`Banks/Mercantile/MercantilePipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Mercantile/MercantilePipeline.ts) |

## Known quirks

- Subsidiary of Discount Bank — uses similar login fields (`id`, `password`, `num`).
- Minimal browser pipeline — no PRE-LOGIN, no OTP.

## Hard-model post-auth

After login, Mercantile uses the hard-model post-auth path (`withBrowserApiDirect`):
instead of the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE / DASHBOARD / SCRAPE /
BALANCE-RESOLVE chain, the `MERCANTILE_SHAPE` `IApiDirectScrapeShape`
(`Banks/Mercantile/scrape/MercantileShape.ts`) declares the exact accounts,
balance, and transactions API calls, issued directly through the live login
page. See [api-direct-scrape](../phases/api-direct-scrape.md) for the phase
contract.
