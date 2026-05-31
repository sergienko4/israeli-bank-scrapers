# Bank Yahav

--8<-- "_deprecated.md"

| | |
|---|---|
| `CompanyTypes` | `Yahav` |
| Engine | **Legacy** (`BaseScraperWithBrowser`) — **not on Pipeline** |
| Credentials | `username`, `nationalID`, `password` |
| OTP | — |
| Registry | `SCRAPER_REGISTRY_LEUMI_TO_YAHAV` |
| Source | `src/Scrapers/Yahav/YahavScraper.ts` |

## Quick example

```typescript
const result = await scraper.scrape({
  username: 'myuser',
  nationalID: '123456789',
  password: 'mypassword',
});
```

## Known quirks

- Three-field login — Yahav requires `nationalID` in addition to `username` + `password`.

## Migration status

**Wave 2** target in the [migration plan](../architecture/migration.md) — moves after Leumi/Mizrahi land. The three-field login translates cleanly to Pipeline's `LoginConfig`.
