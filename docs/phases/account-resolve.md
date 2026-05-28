# ACCOUNT-RESOLVE

Discover the list of accounts/cards the user has access to and the billing-cycle catalog for credit cards. Produces the `ids[]` + `records[]` that SCRAPE iterates and BALANCE-RESOLVE consumes.

| | |
|---|---|
| **Always-on?** | Yes (`ifBrowser`) |
| **Owner slot** | `accountDiscovery: Option<IAccountDiscovery>` |
| **Source** | [`AccountResolvePhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/AccountResolve/AccountResolvePhase.ts) + [`AccountResolveActions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Read the bank's account-discovery endpoint from `IApiFetchContext`. |
| `.action` | Issue the discovery call; parse the response via `findFieldValue` against the bank's WK field aliases (e.g. `cardUniqueId`, `accountId`, `bankAccountUniqueId`). |
| `.post` | Validate `ids.length > 0`; build the billing-cycle catalog for card banks. |
| `.final` | Commit `accountDiscovery: { ids, records, containers, endpointCaptureIndex, billingCycleCatalog? }`. |

## IAccountDiscovery shape

```typescript
interface IAccountDiscovery {
  readonly ids: readonly string[];                               // iter ids — what SCRAPE loops over
  readonly records: readonly Record<string, unknown>[];          // raw record per id (same order)
  readonly containers: Record<string, unknown>;                  // outer containers for nested shapes
  readonly endpointCaptureIndex: number;                         // which pool entry the discovery came from
  readonly billingCycleCatalog?: IBillingCycleCatalog;           // card banks only
}
```

## How identities get propagated

`SCRAPE.post` reads `accountDiscovery.records` and emits `accountIdentities` — one `(cardDisplayId, cardUniqueId, bankAccountUniqueId)` triple per record. The triple flows to BALANCE-RESOLVE which uses it for per-card extraction.

See [BALANCE-RESOLVE → Sub-step quick reference](balance-resolve.md#sub-step-quick-reference).

## Failure modes

| `errorType` | Cause |
|---|---|
| `GENERIC "no usable account identifier"` | Discovery returned 0 records — bank API contract drift, expired session, or the user has no accounts |
| `TIMEOUT` | Discovery call didn't complete |
