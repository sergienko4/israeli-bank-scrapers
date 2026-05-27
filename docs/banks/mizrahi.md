# Mizrahi Bank

--8<-- "_deprecated.md"

| | |
|---|---|
| `CompanyTypes` | `Mizrahi` |
| Engine | **Legacy** (`BaseScraperWithBrowser`) — **not on Pipeline** |
| Credentials | `username`, `password` |
| OTP | — |
| Registry | `SCRAPER_REGISTRY_LEUMI_TO_YAHAV` |
| Source | [`src/Scrapers/Mizrahi/MizrahiScraper.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Mizrahi/MizrahiScraper.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  username: 'myuser',
  password: 'mypassword',
});
```

## Migration status

**Wave 1** target in the [migration plan](../architecture/migration.md) — Mizrahi is a high-traffic legacy bank, so it lands in the first migration wave alongside Leumi.
