# Mizrahi Bank

!!! warning "Pipeline migration in progress"
    The legacy (non-Pipeline) Mizrahi scraper was removed. Mizrahi is being
    onboarded to the Pipeline; until that lands, `createScraper` rejects
    `CompanyTypes.Mizrahi` with `unknown company id mizrahi`.

| | |
|---|---|
| `CompanyTypes` | `Mizrahi` |
| Engine | Browser (Pipeline) — **migration in progress** |
| Credentials | `username`, `password` |
| OTP | — |

## Migration status

**Wave 1** target in the [migration plan](../architecture/migration.md). The legacy scraper was
removed first; the Pipeline bank lands phase by phase (login form, then the hard-model API-direct
scrape), each phase proven by a real run.
