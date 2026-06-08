# Bank Leumi

--8<-- "_deprecated.md"

| | |
|---|---|
| `CompanyTypes` | `Leumi` |
| Engine | **Legacy** (`BaseScraperWithBrowser`) — **not on Pipeline** |
| Credentials | `username`, `password` |
| OTP | — |
| Registry | `SCRAPER_REGISTRY_LEUMI_TO_YAHAV` |
| Source | [`src/Scrapers/Leumi/LeumiScraper.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Leumi/LeumiScraper.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  username: 'myuser',
  password: 'mypassword',
});
```

## Migration status

**Wave 1** target in the [migration plan](../architecture/migration.md) — Leumi is one of the highest-traffic legacy banks, so it lands first to surface regressions early. Until then, `createScraper(CompanyTypes.Leumi, ...)` uses the legacy scraper. Public API and result shape preserved.
