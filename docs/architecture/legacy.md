# Legacy (removed)

The pre-Pipeline scraper chain no longer exists. Every registered bank runs on the [Pipeline](pipeline.md), and `createScraper` throws `unknown company id <id>` for an id with no Pipeline entry. This page records what was removed and which `ScraperOptions` fields therefore have no effect.

## What was removed

### Bank scrapers

Behatsdaa and Beyahad Bishvilha were the last two non-Pipeline banks. They were removed in v10 together with their `CompanyTypes` keys.

> **Bank Leumi** and **Bank Yahav** were migrated to the Pipeline earlier and their
> legacy scrapers deleted — they are pipeline-only (see
> [Bank Leumi](../banks/leumi.md), [Bank Yahav](../banks/yahav.md)). **Mizrahi
> Bank** moved to the Pipeline in one migration: the change that deleted its
> legacy scraper also registered the Pipeline bank, so `createScraper` resolves
> Mizrahi on every revision (see [Mizrahi Bank](../banks/mizrahi.md)).

### Base classes and utilities

The shared chain that only those banks used went with them:

- the abstract and browser-backed base scrapers, the generic bank scraper and its login-chain builder
- the declarative login-step and navigation-retry helpers
- the legacy OTP detector and OTP handler (API-direct login steps now own OTP)
- the legacy storage, date and transaction helpers, and the legacy scraper registry

What stays is the **layer-5 shared infra** (see [Layer separation](layers.md#what-lives-in-layer-5)): public types, error classes and the HTTP pipeline contracts.

## Removed legacy scraper options, methods, and types

In v10, all remaining legacy-only `ScraperOptions` fields (`includeRawTransaction`, `optInFeatures`, `outputData`, `shouldAddTransactionInformation`, `shouldCombineInstallments`, `usePipeline`, `verbose`), unimplemented `IScraper` methods (`triggerTwoFactorAuth`, `getLongTermTwoFactorToken`), `ScraperErrorTypes.General` (`'GENERAL_ERROR'`), and legacy result/option types (`IScraperLoginResult`, `ScraperLoginResult`, `ScaperLoginResult`, `ScaperScrapingResult`, `IOutputDataOptions`, `OptInFeatures`, `IFutureDebit`, `IScraperDiagnostics`, `ITransaction.rawTransaction`) were removed from the public TypeScript surface (`api-surface.d.ts`).

| Option                            | Former reader                                        |
| --------------------------------- | ---------------------------------------------------- |
| `includeRawTransaction`           | the legacy transaction mapper (removed)              |
| `optInFeatures`                   | none (legacy Mizrahi removed)                        |
| `outputData`                      | the Beyahad Bishvilha scraper (removed)              |
| `shouldAddTransactionInformation` | none (legacy Mizrahi removed)                        |
| `shouldCombineInstallments`       | none (`filterOldTransactions` takes a resolved flag) |
| `usePipeline`                     | none (Pipeline is the only architecture)             |
| `verbose`                         | none (replaced by `LOG_LEVEL` / `loginLogLevel`)     |

See [Configuration — Removed legacy options](../configuration.md#options-the-pipeline-ignores).

**Raw provider payloads** are available on the
Pipeline through `FORENSIC_TRACE=true`, which writes every request and response
body to `network/*.json` under `RUNS_ROOT` with PII redaction applied by default
— see [Observability](../observability/index.md) and
[PII redaction](../observability/redaction.md).

## Where new code goes

- ✅ A new bank is a Pipeline bank under `src/Scrapers/Pipeline/Banks/<Name>/` — never `src/Scrapers/<Name>/`.
- ✅ Shared types live in layer 5: `src/Scrapers/Base/Interface.ts`, `ErrorTypes.ts`, `ScraperError.ts`, `Interfaces/**`.
- ❌ Do not reintroduce a browser bootstrap or a legacy scraper path.

See [Migration strategy](migration.md) for how the removal was sequenced.
