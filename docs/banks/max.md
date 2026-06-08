# Max (formerly Leumi Card)

| | |
|---|---|
| `CompanyTypes` | `Max` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` |
| OTP | — |
| Phase chain | INIT → HOME → **PRE-LOGIN** → LOGIN → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
| Source | [`Banks/Max/MaxPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Max/MaxPipeline.ts) |

## Known quirks

- All Max selectors were migrated from CSS/IDs to **visible Hebrew text** in v8.2.0.
- Max + Isracard + Amex are the three credit-card brands with PRE-LOGIN.
- BALANCE-RESOLVE plan is per-bank-account — Max users typically have one BA per card.
