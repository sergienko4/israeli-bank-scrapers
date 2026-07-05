# Legacy (deprecated)

--8<-- "_deprecated.md"

## What counts as legacy

Everything **outside `src/Scrapers/Pipeline/`** except the **layer-5 shared infra** (see [Layer separation](layers.md#what-lives-in-layer-5-vs-layer-6)).

### Legacy bank scrapers

| Bank              | File                                               | `createScraper` route                        |
| ----------------- | -------------------------------------------------- | -------------------------------------------- |
| Behatsdaa         | `src/Scrapers/Behatsdaa/BehatsdaaScraper.ts`       | `SCRAPER_REGISTRY_AMEX_TO_ISRACARD` (subset) |
| Beyahad Bishvilha | (registered in `ScraperRegistryAmexToIsracard.ts`) | `SCRAPER_REGISTRY_AMEX_TO_ISRACARD`          |
| Mizrahi Bank      | `src/Scrapers/Mizrahi/MizrahiScraper.ts`           | `SCRAPER_REGISTRY_LEUMI_TO_YAHAV`            |

> **Bank Leumi** and **Bank Yahav** were migrated to the Pipeline and their
> legacy scrapers deleted — they are now pipeline-only (see
> [Bank Leumi](../banks/leumi.md), [Bank Yahav](../banks/yahav.md)).

### Legacy base classes

| File                                          | Role                                            |
| --------------------------------------------- | ----------------------------------------------- |
| `src/Scrapers/Base/BaseScraper.ts`            | Abstract `IScraper` implementation pre-Pipeline |
| `src/Scrapers/Base/BaseScraperWithBrowser.ts` | Adds Playwright lifecycle to `BaseScraper`      |
| `src/Scrapers/Base/BaseScraperHelpers.ts`     | Shared helpers consumed by the above            |
| `src/Scrapers/Base/ConcreteGenericScraper.ts` | Concrete realisation used by legacy banks       |
| `src/Scrapers/Base/GenericBankScraper.ts`     | Generic bank scraper class                      |

### Legacy utilities

| Path                                                   | Replacement under Pipeline                           |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `src/Common/Browser.ts`                                | `src/Scrapers/Pipeline/Mediator/Browser/`            |
| `src/Common/CamoufoxLauncher.ts`                       | Same — used at the boundary                          |
| `src/Common/Fetch.ts`                                  | `src/Scrapers/Pipeline/Mediator/Network/`            |
| `src/Common/SelectorResolver*.ts`                      | `src/Scrapers/Pipeline/Mediator/Selector/`           |
| `src/Common/OtpDetector.ts`, `OtpHandler.ts`           | `src/Scrapers/Pipeline/Mediator/Otp{Trigger,Fill}/`  |
| `src/Common/Navigation.ts`, `Waiting.ts`, `Storage.ts` | Mediator zones own these directly                    |
| `src/Common/ResultFormatter.ts`                        | `src/Scrapers/Pipeline/Core/PipelineResult.ts`       |
| `src/Common/Debug.ts`                                  | **Still used by Pipeline** — exempt from deprecation |

## Why ship deprecated code?

1. **Public API compatibility** — `createScraper(CompanyTypes.Mizrahi, ...)` already works; removing it would be a breaking change.
2. **Migration is incremental** — porting Mizrahi to Pipeline requires writing a `LoginConfig`, a `PipelineDescriptor`, and registering in `PIPELINE_REGISTRY`. That's a per-bank PR, not a single sweep.
3. **Two-registry dispatch is safe** — `Factory.tryPipeline` is consulted first; legacy is a fallback. When a bank moves to Pipeline, `createScraper` automatically routes there with no caller change.

## What new code should NOT touch

- ❌ `BaseScraper.ts` or any of the 5 legacy base classes
- ❌ Adding a new bank to `src/Scrapers/<Name>/` (use `src/Scrapers/Pipeline/Banks/<Name>/` instead)
- ❌ Importing from `src/Common/` _except_ `Debug.ts`
- ❌ Extending `SCRAPER_REGISTRY_LEUMI_TO_YAHAV` or `SCRAPER_REGISTRY_AMEX_TO_ISRACARD`

## What new code MAY touch

- ✅ `src/Scrapers/Base/Interface.ts` — shared interfaces, layer 5
- ✅ `src/Scrapers/Base/ErrorTypes.ts`, `ScraperError.ts`
- ✅ `src/Scrapers/Base/Config/LoginConfig*.ts`, `Interfaces/**`
- ✅ All of `src/Scrapers/Pipeline/`

See [Migration strategy](migration.md) for the per-bank porting sequence.
