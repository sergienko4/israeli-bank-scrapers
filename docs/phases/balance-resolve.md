# BALANCE-RESOLVE

The phase that owns every live balance fetch and per-card extraction. Lands in v8.4 as the v6 architectural shift.

For the **architectural context + rationale**, read [Architecture → BALANCE-RESOLVE (v6)](../architecture/balance-resolve.md) first — that page explains the v5→v6 motivation.

This page is the **phase orchestrator reference**.

| | |
|---|---|
| **Always-on?** | Yes for browser banks (`ifBrowser`); api-direct banks emit the same `balanceResolution` via [API-DIRECT-SCRAPE.final](api-direct-scrape.md) instead |
| **Owner slots** | `balanceFetchPlan`, `balanceResponsesByBankAccount`, `balanceExtracted`, `balanceValidation`, `balanceResolution` |
| **Source** | [`BalanceResolvePhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/BalanceResolve/BalanceResolvePhase.ts) (thin orchestrator) + [`BalanceResolveActions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.ts) (all logic) |

## Sub-step quick reference

| Hook | Slot written | Slot read |
|---|---|---|
| `.pre` | `balanceFetchPlan` | `scrape.accountIdentities`, `scrape.balanceFetchTemplate` |
| `.action` | `balanceResponsesByBankAccount`, `balanceExtracted` | `balanceFetchPlan`, `api`, `scrape.accountIdentities` |
| `.post` | `balanceValidation` | `balanceExtracted` |
| `.final` | `balanceResolution` | `balanceExtracted`, `balanceValidation` |

## Quarantine pattern

Per-fetch failures (one `bankAccountUniqueId` out of N fails) do **NOT** abort the phase:

1. `.action` emits `balance-resolve.fetch.failure` (warn) with `correlationId` + masked `bankAccountTail4`.
2. The failed entry produces no response — cards keyed to that BA land as `'MISS'` in `balanceExtracted`.
3. `.post` partitions: if **every** card missed → hard-fail. Otherwise partial-resolve passes through with `balance.miss` per-account warns.

This closes the v4 "universal-empty = scrape miss" gate that previously ate legitimate empty months.

## How api-direct banks emit the same slot

For OneZero, Pepper, PayBox, this phase is **not in the chain**. Instead, [`ApiDirectScrapePhase.final`](api-direct-scrape.md#final-emit-balanceresolution-from-scrapeaccounts) reads `scrape.value.accounts[i].balance` (populated by the per-bank shape extractor during `.action`) and emits the same `Map<accountNumber, number>` into `ctx.balanceResolution`.

`PipelineResult` reads `balanceResolution` regardless of which path produced it — one source of truth.

## Observability + lint + tests

See [Architecture → BALANCE-RESOLVE](../architecture/balance-resolve.md) sections "Observability", "Lint enforcement", and "Test coverage".
