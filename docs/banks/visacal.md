# Visa Cal

| | |
|---|---|
| `CompanyTypes` | `VisaCal` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` |
| OTP | — |
| Phase chain | INIT → HOME → **PRE-LOGIN** → LOGIN → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE |
| Source | [`Banks/VisaCal/VisaCalPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.ts) |

## Known quirks

- **Per-card nested response shape** — `result.bigNumbers[].cards[]`. BALANCE-RESOLVE's per-card extractor walks `cardUniqueId` matches inside this nested structure.
- A single Visa Cal customer can have **multiple bank accounts × multiple cards per BA**. The v6 fetch planner deduplicates the per-card identities into one POST per unique `bankAccountUniqueId`, then re-attributes the per-card values from each response.
- BALANCE-RESOLVE quarantine handles per-BA fetch failures — failed BAs MISS without aborting the run.
