# Behatsdaa

--8<-- "_deprecated.md"

| | |
|---|---|
| `CompanyTypes` | `Behatsdaa` |
| Engine | **Legacy** (`BaseScraperWithBrowser`) — **not on Pipeline** |
| Credentials | `id`, `password` |
| OTP | — |
| Registry | `SCRAPER_REGISTRY_AMEX_TO_ISRACARD` |
| Source | [`src/Scrapers/Behatsdaa/BehatsdaaScraper.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Behatsdaa/BehatsdaaScraper.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  id: '123456789',
  password: 'mypassword',
});
```

## Migration status

Scheduled for migration to Pipeline. Until then, `createScraper` automatically routes to the legacy scraper for this bank. Public API and result shape are identical to Pipeline banks.

See [Architecture → Migration strategy](../architecture/migration.md) for the porting sequence.
