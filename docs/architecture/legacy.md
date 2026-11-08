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
- the legacy OTP detector and OTP handler (the Pipeline owns OTP in `src/Scrapers/Pipeline/Mediator/Otp{Trigger,Fill}/`)
- the legacy storage, date and transaction helpers, and the legacy scraper registry

What stays is the **layer-5 shared infra** (see [Layer separation](layers.md#what-lives-in-layer-5)): the public types, error classes and declarative login-config types the Pipeline imports.

## Legacy-only scraper options

`ScraperOptions` is one flat type, so the compiler accepts every field for every bank. Eight of them have no implementation and no effect. The legacy scrapers that read five of them are gone; the other three never had a reader since the legacy Mizrahi scraper was removed.

| Option                            | Former reader                                                      |
| --------------------------------- | ------------------------------------------------------------------ |
| `includeRawTransaction`           | the legacy transaction mapper (removed)                            |
| `navigationRetryCount`            | the legacy browser scraper (removed)                               |
| `optInFeatures`                   | none (legacy Mizrahi removed)                                      |
| `outputData`                      | the Beyahad Bishvilha scraper (removed)                            |
| `shouldAddTransactionInformation` | none (legacy Mizrahi removed)                                      |
| `shouldCombineInstallments`       | none (`filterOldTransactions` takes a resolved flag)               |
| `skipCloseBrowser`                | the legacy browser scraper (removed)                               |
| `storeFailureScreenShotPath`      | the legacy browser scraper (removed)                               |

`createScraper` emits a `ScraperOptionsWarning` when any of them is passed — see [Configuration](../configuration.md#options-the-pipeline-ignores). The warning is kept on purpose: dropping it would turn a deprecated field into a silent no-op, which is the defect reported in issue #540.

The manifest that drives the warning lives in
`src/Scrapers/Pipeline/Core/LegacyOnlyOptions.ts`, which exports four symbols:

| Symbol | Role |
| --- | --- |
| `LEGACY_ONLY_OPTIONS` | The manifest itself — the eight option names, alphabetical |
| `LegacyOnlyOption` | Union of those names, so a typo is a compile error |
| `findLegacyOnlyOptions` | Returns the legacy-only options a caller actually supplied |
| `warnLegacyOnlyOptions` | Emits the warning; called by `createScraper` |

A change that implements one of these options on the Pipeline must delete its entry from
`LEGACY_ONLY_OPTIONS` in the same change, or `createScraper` will keep warning that
a now-working option is ignored.

This guard and the [browser-options guard](../configuration.md#browser-options-on-browserless-banks)
share `src/Scrapers/Pipeline/Core/SuppliedOptions.ts`: `findSuppliedOptions`
treats any defined value, `false` and `0` included, as supplied, and
`warnIgnoredOptions` emits one `ScraperOptionsWarning` per call, so both guards
judge presence and warn the same way.

`browserContext` is also unread now (the legacy launcher that honoured it was
removed), but it sits outside this manifest: it is a required member of an
options-union arm rather than a stray flag. It is documented instead under
[Browser lifecycle options](../configuration.md#browser-lifecycle-options).

**These options will not be ported.** Raw provider payloads are available on the
Pipeline through `FORENSIC_TRACE=true`, which writes every request and response
body to `network/*.json` under `RUNS_ROOT` with PII redaction applied by default
— see [Observability](../observability/index.md) and
[PII redaction](../observability/redaction.md).

## Where new code goes

- ✅ A new bank is a Pipeline bank under `src/Scrapers/Pipeline/Banks/<Name>/` — never `src/Scrapers/<Name>/`.
- ✅ Shared types live in layer 5: `src/Scrapers/Base/Interface.ts`, `ErrorTypes.ts`, `ScraperError.ts`, `Config/LoginConfig*.ts`, `Interfaces/**`.
- ❌ Do not import `src/Common/` from the Pipeline — the one allowlisted edge is
  `src/Common/Config/BrowserConfig.ts` (browser bootstrap, no Pipeline duplicate).

See [Migration strategy](migration.md) for how the removal was sequenced.
