# Layer separation

The codebase is organised into **8 logical layers** (per the `/understand` knowledge-graph analysis). Every file belongs to exactly one. Imports flow downward — a higher layer may import from a lower one, never the reverse.

```mermaid
flowchart TB
    L1["1. Public API<br/>src/index.ts · Definitions · Transactions"]
    L2["2. Pipeline orchestration<br/>Builder · Executor · phase classes"]
    L3["3. Pipeline mediator<br/>API login · HTTP · OTP callbacks · Scrape"]
    L4["4. Pipeline strategy + registry<br/>Fetch + Scrape strategies · per-bank configs and shapes"]
    L5["5. Pipeline types<br/>BasePhase · Procedure · Option · PiiRedactor · PipelineContext"]
    L6["6. Common utilities (residual)<br/>src/Common/ — result and transaction formatting"]
    L7["7. Tests<br/>src/Tests/ — Unit / Pipeline / E2eMocked / E2eReal / Helpers"]
    L8["8. Build & CI<br/>GitHub Actions · husky · Dockerfile.ci-mirror · tsup · biome · eslint"]

    L1 --> L2
    L2 --> L3 --> L4 --> L5
    L7 --> L1
    L7 --> L2
    L7 --> L3
    L8 -.->|"orchestrates"| L7
```

## Layer details

| #   | Layer                        | Path                                                                                                                                     | Status              |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | Public API                   | `src/index.ts`, `src/Definitions.ts`, `src/Transactions.ts`, `src/Scrapers/Registry/Factory.ts`                                          | Stable              |
| 2   | Pipeline orchestration       | `src/Scrapers/Pipeline/Core/`, `src/Scrapers/Pipeline/Phases/`                                                                           | Canonical           |
| 3   | Pipeline mediator            | `src/Scrapers/Pipeline/Mediator/` (Api, ApiDirectCall, Network, Scrape, Timing)                                                          | Canonical           |
| 4   | Pipeline strategy + registry | `src/Scrapers/Pipeline/Strategy/`, `src/Scrapers/Pipeline/Banks/`, `src/Scrapers/Pipeline/Registry/`, `src/Scrapers/Registry/Factory.ts` | Canonical           |
| 5   | Pipeline types               | `src/Scrapers/Pipeline/Types/`, `src/Scrapers/Base/{Interface, ErrorTypes, ScraperError, Config/, Interfaces/}`                          | Shared infra        |
| 6   | Common utilities (residual)  | `src/Common/` (result and transaction formatting)                                                                                        | Test/result helpers |
| 7   | Tests                        | `src/Tests/Unit/`, `src/Tests/E2eMocked/`, `src/Tests/E2eReal/`, `src/Tests/Helpers/`, `src/Tests/Tools/`                                | Always-on gate      |
| 8   | Build & CI                   | `.github/workflows/`, `.husky/`, `tsup.config.ts`, `biome.json`, `eslint.config.mjs`, `eslint/`, `tsconfig.json`                                    | Always-on gate      |

## What lives in layer 5

**Layer 5 (shared infra)** retains the public and pipeline contracts:

- `src/Scrapers/Base/Interface.ts` — `IScraper`, `IScraperScrapingResult`, `ScraperOptions`, `ScraperCredentials`
- `src/Scrapers/Base/ErrorTypes.ts` — `ScraperErrorTypes` enum
- `src/Scrapers/Base/ScraperError.ts` — error class
- `src/Scrapers/Base/Interfaces/**` — all sub-interfaces

The former legacy layer (the base scrapers, per-bank classes and their `src/Common/` helpers) was removed once no registered bank used it — see [Legacy (removed)](legacy.md).

## Well-known (WK) registry seeding and freeze

Layer 4's well-known URL and GraphQL query registries (`src/Scrapers/Pipeline/Registry/WK/UrlsWK.ts` and `QueriesWK.ts`) keep their backing maps module-private and follow a two-phase lifecycle:

1. **Module-load seeding:** `PipelineBankConfig.ts` seeds every bank's transport URLs via `seedWkFromPipelineConfig` (calling `@internal` `registerWkUrl`), and the GraphQL banks (`OneZeroQueries.ts`, `PepperQueries.ts`, statically imported through `PipelineRegistry.ts` and `src/Scrapers/Registry/Factory.ts`) register their operations via `@internal` `registerWkQuery` before any scrape begins.
2. **Freeze on first read:** the first `resolveWkUrl` or `resolveWkQuery` call marks its registry frozen (`ensureFrozen()`); any subsequent `registerWkUrl` or `registerWkQuery` call fails closed with a `ScraperError`. Unit tests that construct isolated fixtures load a fresh module instance with `jest.resetModules()`, so the registry starts unfrozen.

## Import direction enforcement

The architecture validator (`lint:architecture`) runs on every commit and rejects:

- Disallowed cross-layer imports
- Cross-mediator imports that bypass the declared contracts

Source: [`src/Tests/Tools/lint-and-validate.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Tests/Tools/lint-and-validate.ts) + the 3 architecture canaries under `src/Scrapers/Pipeline/EslintCanaries/`.

The eight Pipeline directories are pinned by
`src/Tests/Unit/Pipeline/Architecture/LayerDirectionPolicy.test.ts` in this
order, highest composition layer first:

`Banks → Core → Phases → Mediator → {Strategy, Registry} → Logging → Types`

A layer may import itself or any layer to its right; `Banks` is the composition
layer, so it may import every layer, while `Core` may not import `Banks`
(separately enforced by `CoreBankIndependence`). `Strategy` and `Registry` are
siblings and may import each other. `Types` is a leaf.

Current violations are frozen in `src/Tests/Tools/layer-direction.baseline.json`.
A new edge fails the test; when an edge is fixed, its baseline entry must be
removed in the same change, so the ratchet only shrinks. CI also runs a
tamper-guard (`.github/scripts/ci/layer-direction-baseline-guard.sh`) that
compares the baseline against the PR base and rejects any added entry, so a
forbidden edge cannot be introduced together with its own exception. The same test rejects a
bank-named module or a `CompanyTypes.<X>` reference in `Phases`, `Mediator` or
`Strategy`, and the four family shape directories are frozen there until they
move under `Banks/_Shared`.
