# API-DIRECT-SCRAPE

Shape-driven JSON/GraphQL walk that replaces SCRAPE + BALANCE-RESOLVE for api-direct banks. Same `PRE → ACTION → POST → FINAL` lifecycle as the browser pair, but the action is a shape-extractor pass rather than a DOM walk.

| | |
|---|---|
| **Always-on?** | api-direct banks only |
| **Owner slots** | `scrape`, `balanceResolution` |
| **Source** | [`ApiDirectScrapePhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.ts) + [`ApiDirectScrapeSteps.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeSteps.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Read `IApiDirectScrapeShape` from the bank's `PipelineDescriptor`: per-account txn query + per-account balance query + extractors. |
| `.action` | For each `accountId`, run `fetchAccountTransactions` (calls the txn endpoint, extracts via the bank's `txnExtract`) + `fetchBalance` (calls the balance endpoint, extracts via `balanceExtract`, returning an `IBalanceOutcome` that records whether the value is real or a `fallbackOnFail` mask). Per-account `balance` lands on `scrape.accounts[i].balance` directly. |
| `.post` | Forensic audit — emits the per-account `--- Account <masked> | <N> txns ---` line via `logForensicAudit`, then runs the optional **result guard** (see below). |
| `.final` | **Emit `balanceResolution` from `scrape.accounts`** — builds `Map<accountNumber, balance>` directly. `PipelineResult` reads it the same way as browser banks. |

## .final — Emit balanceResolution from scrape.accounts

```typescript
// ApiDirectScrapePhase.final (paraphrased)
const map = new Map<string, number>();
for (const acc of scrape.value.accounts) {
  map.set(acc.accountNumber, acc.balance ?? 0);
}
return succeed({ ...input, balanceResolution: some(map) });
```

This is what closes the cross-path unification: `PipelineResult.combineWithBalance` reads `ctx.balanceResolution` regardless of which scrape path produced it.

See [Architecture → BALANCE-RESOLVE (v6)](../architecture/balance-resolve.md) for the cross-path rationale.

## Result guard — fail-closed degraded-token detection

A structurally-valid but server-revoked warm token can clear login yet
produce an empty scrape: the balance endpoint errors, the bank's
`fallbackOnFail` masks that error to `0`, the transactions endpoint
returns an empty page, and the phase would otherwise emit a silent
`success([])` — zero transactions, no error. That silent-success path
is the regression the test pyramid previously missed.

The optional `resultGuard` shape hook closes it. After the `.post`
forensic audit, the phase summarises the run into an
`IApiDirectScrapeGuardSummary` (`accountCount`, `totalTxns`,
`balanceDegraded`) and hands it to the bank's guard. The summary keys
on the balance step **outcome**, never its value: because each
`fetchBalance` returns an `IBalanceOutcome` (`{ value, degraded }`), a
genuine balance of `0` stays distinguishable from a fallback-masked `0`.

PayBox opts in via `payBoxResultGuard`, which fails the phase closed
with a `Generic` error when `accountCount >= 1 && totalTxns === 0 &&
balanceDegraded` — i.e. a degraded token produced an empty scrape.
OneZero and Pepper leave `resultGuard` undefined, so their behaviour is
byte-identical: the guard is a no-op that returns the input unchanged.

## Per-bank shape extractors

Each api-direct bank declares its own `IApiDirectScrapeShape`:

| Bank | TXN query | Balance query | Source |
|---|---|---|---|
| OneZero | `GET_ACCOUNT_TRANSACTIONS` GraphQL | `GET_ACCOUNT_BALANCE` GraphQL | [`Banks/OneZero/scrape/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Banks/OneZero/scrape) |
| Pepper | REST `/transactions` | REST `/balance` | [`Banks/Pepper/scrape/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Pepper/scrape) |
| PayBox | REST `/wallet/transactions` | REST `/wallet/balance` | [`Banks/PayBox/scrape/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Banks/PayBox/scrape) |

The shape interface (`balanceVars`, `balanceExtract`, `txnVars`, `txnExtract`) is uniform; only the per-bank closures differ.
