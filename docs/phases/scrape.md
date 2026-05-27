# SCRAPE

Per-account transaction walk. Emits the typed inputs that [BALANCE-RESOLVE](balance-resolve.md) consumes.

| | |
|---|---|
| **Always-on?** | Yes (`ifAnyScraper`) |
| **Owner slot** | `scrape: Option<{ accounts, accountIdentities, balanceFetchTemplate }>` |
| **Source** | [`ScrapePhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Phases/Scrape/ScrapePhase.ts) + [`ScrapePhaseActions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Forensic priming (run [PopupInterceptor](../architecture/pipeline.md#interceptors-cross-cutting-no-data)); DIRECT discovery (read `accountDiscovery.ids`, freeze the network pool, seal). |
| `.action` | Sealed action: frozen matrix loop — for each `accountId`, run the bank's `IFetchStrategy` against the frozen txn endpoint + harvest, parse transactions. |
| `.post` | **v6 emission** — build `accountIdentities` (per-card triples) + `balanceFetchTemplate` from the captured pool; audit forensic per-account txn counts; consult the empty-gate heuristic. |
| `.final` | Stamp account count into diagnostics. |

## What v6 changed

Before v6, `.post` also computed `perAccountResponses` — a partial pool with attribution heuristics — that BALANCE-RESOLVE consumed. v6 removed that path (~370 LOC) and replaced it with two typed fields:

| Field | Built from | Consumed by |
|---|---|---|
| `accountIdentities: ReadonlyMap<cardDisplayId, IAccountIdentity>` | `accountDiscovery.records` via `buildAccountIdentities` | `BALANCE-RESOLVE.pre` |
| `balanceFetchTemplate: IBalanceFetchTemplate` | Captured pool via `discoverBalanceFetchTemplate` (tries POST-with-bodyKey → GET-with-queryKey → GET-with-path-tail → bulk fallback) | `BALANCE-RESOLVE.pre` |

See [Architecture → BALANCE-RESOLVE](../architecture/balance-resolve.md) for the rationale.

## Empty-gate heuristic (v4 Issue 2)

`executeValidateResults` distinguishes a real scrape miss from a legitimate empty result:

| Condition | Action |
|---|---|
| 0 accounts in `scrape.accounts` | `Procedure fail` "no accounts produced" |
| Accounts produced, all with `txns.length === 0`, AND `network.countSuccessfulResponses() > 0` | succeed (legitimate empty month) |
| Accounts produced, all empty, AND `countSuccessfulResponses() === 0` | `Procedure fail` "scrape miss" |

Test coverage: [`EmptyGateHeuristic.test.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Tests/Unit/Pipeline/Mediator/Scrape/EmptyGateHeuristic.test.ts).

## Forensic audit observability

`.post` invokes [`logForensicAudit`](../observability/forensic-audit.md) which emits the per-account `--- Account <masked> | <N> txns ---` line. Same hook runs in [API-DIRECT-SCRAPE.post](api-direct-scrape.md) so every scrape path produces the same diagnostic.
