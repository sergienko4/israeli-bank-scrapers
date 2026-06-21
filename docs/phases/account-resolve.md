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
| `.pre` | Wait for an id-bearing pre-nav capture; if the passive pool stays sparse, nudge the SPA to the cards/transactions view and wait again. |
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

## Sparse capture recovery

BLUF: ACCOUNT-RESOLVE is passive-first, but it now has a generic recovery
nudge for same-URL card SPAs whose account list API does not fire during
login. When the initial id-capture wait times out with no usable id,
`nudgeToCardsView` drives the page toward the cards/transactions view and
then re-runs the same wait so POST can read the newly captured accounts API.

The nudge remains bank-agnostic. It walks the OCP tier list declared by
`NudgeTier`: direct transactions click, menu-expand then click, and finally
href navigation to a well-known transactions URL. The href tier rejects
login-redirect or non-transactions URLs before navigation. `INudgeArgs`
bundles only the mediator and logger, keeping the recovery decoupled from
bank-specific code and from shared orchestration.

## Failure modes

| `errorType` | Cause |
|---|---|
| `GENERIC "no usable account identifier"` | Discovery returned 0 records — bank API contract drift, expired session, or the user has no accounts |
| `TIMEOUT` | Discovery call didn't complete |
