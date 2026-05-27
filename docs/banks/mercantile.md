# Mercantile Bank

| | |
|---|---|
| `CompanyTypes` | `Mercantile` |
| Engine | Browser (Pipeline) |
| Credentials | `id`, `password`, `num` |
| OTP | — |
| Phase chain | INIT → HOME → LOGIN → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
| Source | [`Banks/Mercantile/MercantilePipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Banks/Mercantile/MercantilePipeline.ts) |

## Known quirks

- Subsidiary of Discount Bank — uses similar login fields (`id`, `password`, `num`).
- Minimal browser pipeline — no PRE-LOGIN, no OTP.
