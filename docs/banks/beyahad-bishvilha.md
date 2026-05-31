# Beyahad Bishvilha

--8<-- "_deprecated.md"

| | |
|---|---|
| `CompanyTypes` | `BeyahadBishvilha` |
| Engine | **Legacy** (`BaseScraperWithBrowser`) — **not on Pipeline** |
| Credentials | `id`, `password` |
| OTP | — |
| Registry | `SCRAPER_REGISTRY_AMEX_TO_ISRACARD` |
| Source | `src/Scrapers/BeyahadBishvilha/` |

## Quick example

```typescript
const result = await scraper.scrape({
  id: '123456789',
  password: 'mypassword',
});
```

## Migration status

Scheduled for migration to Pipeline. Until then, `createScraper` routes to the legacy scraper automatically.
