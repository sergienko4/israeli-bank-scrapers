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

## Legacy-only scraper options

Five retained fields have no implementation and no effect. Browser-specific
fields are removed from the type rather than included in this warning list.

| Option                            | Former reader                                        |
| --------------------------------- | ---------------------------------------------------- |
| `includeRawTransaction`           | the legacy transaction mapper (removed)              |
| `optInFeatures`                   | none (legacy Mizrahi removed)                        |
| `outputData`                      | the Beyahad Bishvilha scraper (removed)              |
| `shouldAddTransactionInformation` | none (legacy Mizrahi removed)                        |
| `shouldCombineInstallments`       | none (`filterOldTransactions` takes a resolved flag) |

`createScraper` emits a `ScraperOptionsWarning` when any of them is passed — see [Configuration](../configuration.md#options-the-pipeline-ignores). The warning is kept on purpose: dropping it would turn a deprecated field into a silent no-op, which is the defect reported in issue #540.

The manifest that drives the warning lives in
`src/Scrapers/Pipeline/Core/LegacyOnlyOptions.ts`, which exports four symbols:

| Symbol                  | Role                                                       |
| ----------------------- | ---------------------------------------------------------- |
| `LEGACY_ONLY_OPTIONS`   | The manifest itself — five option names, alphabetical      |
| `LegacyOnlyOption`      | Union of those names, so a typo is a compile error         |
| `findLegacyOnlyOptions` | Returns the legacy-only options a caller actually supplied |
| `warnLegacyOnlyOptions` | Emits the warning; called by `createScraper`               |

A change that implements one of these options on the Pipeline must delete its entry from
`LEGACY_ONLY_OPTIONS` in the same change, or `createScraper` will keep warning that
a now-working option is ignored.

The guard uses `src/Scrapers/Pipeline/Core/SuppliedOptions.ts`: `findSuppliedOptions`
treats any defined value, `false` and `0` included, as supplied, and
`warnIgnoredOptions` emits one `ScraperOptionsWarning` per call, listing
names but never values.

**These options will not be ported.** Raw provider payloads are available on the
Pipeline through `FORENSIC_TRACE=true`, which writes every request and response
body to `network/*.json` under `RUNS_ROOT` with PII redaction applied by default
— see [Observability](../observability/index.md) and
[PII redaction](../observability/redaction.md).

## Where new code goes

- ✅ A new bank is a Pipeline bank under `src/Scrapers/Pipeline/Banks/<Name>/` — never `src/Scrapers/<Name>/`.
- ✅ Shared types live in layer 5: `src/Scrapers/Base/Interface.ts`, `ErrorTypes.ts`, `ScraperError.ts`, `Interfaces/**`.
- ❌ Do not reintroduce a browser bootstrap or a legacy scraper path.

See [Migration strategy](migration.md) for how the removal was sequenced.
