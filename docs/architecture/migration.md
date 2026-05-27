# Migration strategy

> **Goal:** every bank lives under `src/Scrapers/Pipeline/`, every utility in `src/Common/` is replaced by a mediator zone, every legacy base class is deleted. Public API behavior preserved throughout.

## What we did in v8.4 (precedent)

The `BALANCE-RESOLVE` v6 rewrite (commit `c267d48b`) is the template:

1. **Design the typed contract first** — `IAccountIdentity`, `IBalanceFetchTemplate`, `IBalanceFetchPlanEntry`, `IBalanceExtracted`, `IBalanceValidation` landed in `PipelineContext.ts` before any logic moved.
2. **Build a side POC** — `c:\tmp\balance-poc-v6\` exercised the algorithm against captured fixtures for 7 banks, GREEN before pipeline code changed.
3. **Move the logic phase-by-phase** — `executeBalanceResolvePre/Action/Post/Final` written under `Mediator/BalanceResolve/`, `BalanceResolvePhase` thin orchestrator in `Phases/BalanceResolve/`.
4. **Delete the old path** — `Strategy/Scrape/Account/BalanceExtractor.ts`, `perAccountResponses`, attribution helpers (~370 LOC).
5. **Lock the boundary** — 3 ESLint canaries reject any future reach across the split.
6. **Validate everything** — 4807 unit tests, coverage thresholds (97/95/97/98) met, mock-E2E + dead-code + biome + tsc + format all green before commit.

Total LOC delta: **+5285 / −510**, 68 files touched.

## Per-bank migration sequence

For each legacy bank, the porting PR does:

| Step | File / change |
|---|---|
| 1 | Write `src/Scrapers/Pipeline/Banks/<Bank>/<Bank>LoginConfig.ts` — declarative `LoginConfig` (visible-text selectors, field list, submit anchor) |
| 2 | Write `src/Scrapers/Pipeline/Banks/<Bank>/<Bank>Pipeline.ts` — `buildXxxPipeline(options)` returns a `Procedure<IPipelineDescriptor>` |
| 3 | Register in `src/Scrapers/Pipeline/Core/PipelineRegistry.ts` — `[CT.<Bank>]: buildXxxPipeline` |
| 4 | Write fixtures under `src/Tests/E2eMocked/<Bank>/fixtures/` from a captured real-bank run |
| 5 | Verify with `npm run test:e2e:mock --testPathPatterns=<Bank>` and `npm run test:e2e:real:single -- --testPathPatterns=<Bank>` |
| 6 | Once green, delete `src/Scrapers/<Bank>/` and remove from `SCRAPER_REGISTRY_LEUMI_TO_YAHAV.ts` or its sibling |
| 7 | Re-run `lint:dead-code` to confirm no unused exports remain |

The 14 banks already on Pipeline followed exactly this sequence over v8.3 → v8.4.

## Per-utility migration sequence

For each `src/Common/` helper that the Pipeline does NOT already use:

| Step | Change |
|---|---|
| 1 | Identify the **mediator zone** that owns its concern (e.g. `Mediator/Browser/`, `Mediator/Selector/`, `Mediator/Network/`) |
| 2 | Move the helper into the zone (keeping the API surface for in-flight callers) |
| 3 | Update every importer in `src/Scrapers/Pipeline/` to use the new path |
| 4 | Mark the original under `src/Common/` as `@deprecated` until the last legacy bank caller is gone |
| 5 | When the last legacy caller is migrated, delete the original |

## Order of operations (proposed)

| Wave | Banks to migrate | Why this wave |
|---|---|---|
| Wave 1 | Mizrahi, Leumi | Largest customer base; biggest test signal |
| Wave 2 | Yahav, Behatsdaa, Beyahad Bishvilha | Smaller — finish the bank surface |
| Wave 3 | `src/Common/` → mediator zones | Now that no legacy bank imports `Common/`, fold remaining helpers |
| Wave 4 | Delete 5 legacy base classes (`BaseScraper`, `BaseScraperWithBrowser`, `BaseScraperHelpers`, `ConcreteGenericScraper`, `GenericBankScraper`) | Layer 6 is empty after wave 3 |
| Wave 5 | Update README + mkdocs to drop the deprecation banners and the "Migration notice" section | End-state docs |

Each wave is a separate PR, gated by:

- All previous waves still green
- `test:pipeline` ≥ 97/95/97/98 thresholds
- `test:e2e:mock` green for both moved banks AND every still-legacy bank
- `lint:architecture` + `lint:dead-code` 0 errors

## Why this order?

- **Mizrahi + Leumi first** — they're the highest-traffic legacy banks, so any regression surfaces fastest in downstream consumers (Caspion, Moneyman, Actual Budget importer).
- **Banks before utilities** — utilities can't safely be deleted while a single legacy bank still imports them. Migrate all bank surfaces, then fold the helpers.
- **Base classes last** — they are an implementation detail; once no caller imports them, they go.

## What stays after migration

- `src/Scrapers/Base/Interface.ts` and the rest of layer 5 — that's the public API surface, not legacy.
- `src/Common/Debug.ts` — the only `Common/` helper Pipeline uses (1 import). Will be moved into `Pipeline/Types/Debug.ts` as part of wave 3.
- The two registries in `src/Scrapers/Registry/` simplify down to a single `PIPELINE_REGISTRY` after wave 2.
