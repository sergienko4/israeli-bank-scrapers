# API-DIRECT-SCRAPE

Shape-driven JSON/GraphQL walk that replaces SCRAPE + BALANCE-RESOLVE for api-direct banks. Same `PRE → ACTION → POST → FINAL` lifecycle as the browser pair, but the action is a shape-extractor pass rather than a DOM walk.

|                 |                                                                                                                                                                                                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Always-on?**  | api-direct banks only                                                                                                                                                                                                                                                                                                                         |
| **Owner slots** | `scrape`, `balanceResolution`                                                                                                                                                                                                                                                                                                                 |
| **Source**      | [`ApiDirectScrapePhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.ts) + [`ApiDirectScrapeSteps.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeSteps.ts) |

## Sub-step contract

| Hook      | What it does                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.pre`    | Read `IApiDirectScrapeShape` from the bank's `PipelineDescriptor`: per-account txn query + per-account balance query + extractors.                                                                                                                                                                                                                                        |
| `.action` | For each `accountId`, run `fetchAccountTransactions` (calls the txn endpoint, extracts via the bank's `txnExtract`) + `fetchBalance` (calls the balance endpoint, extracts via `balanceExtract`, returning an `IBalanceOutcome` that records whether the value is real or a `fallbackOnFail` mask). Per-account `balance` lands on `scrape.accounts[i].balance` directly. |
| `.post`   | Forensic audit — emits the per-account `--- Account <masked> \| <N> txns ---` line via `logForensicAudit`, then runs the optional **result guard** (see below).                                                                                                                                                                                                             |
| `.final`  | **Emit `balanceResolution` from `scrape.accounts`** — builds `Map<accountNumber, balance>` directly. `PipelineResult` reads it the same way as browser banks.                                                                                                                                                                                                             |

## Prime — post-login SPA navigation (browser banks only)

Cookie-only banks authorise every post-auth service from the login session, so the hard-model driver can call the transactions API the moment login clears. A few browser banks split their services across **separate session scopes**: Amex's browser login authorises the statuspage service, but the transactions API only becomes reachable after the SPA navigates to its `/transactions` frontend route (the generic DASHBOARD phase used to trigger this, logging `primed:true`).

The optional `IApiDirectScrapePrime` shape hook restores that step for the api-direct path. When a shape declares `prime`, `runPrime` navigates the **live login page** to the URL returned by `prime.navUrl(ctx)` and waits for the network to settle before the first scrape fetch. The nav is best-effort and non-fatal — a slow or failed prime never aborts the scrape. It is a strict no-op for banks that omit `prime` (all cookie-only + headless banks) or that run without a browser executor (headless mediators), so their behaviour stays byte-identical.

Amex and Isracard (the DigitalV3 base-isracard-amex family) opt in via their `primeUrl` helper, pointing the hook at `https://web.americanexpress.co.il/transactions` and `https://web.isracard.co.il/transactions` respectively.

Beinleumi and its FIBI-group siblings (OtsarHahayal, Pagi, Massad — the same Mataf/appsng portal) do **not** use this shape hook: their data API lives on a different origin than login (`www.fibi.co.il` → `online.fibi.co.il`), so the cross-origin session hand-off is performed earlier, by AUTH-DISCOVERY's per-bank `postLoginNav` config (navigating to `/appsng/Resources/PortalNG/shell/#/accountSummary` on each bank's `online.<host>`). Navigating there before BIND also seeds the capture pool with the token-carrying `appsng/bff-` requests so BIND's auth-header sniff finds them.

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

When a shape declares **no** `resultGuard`, the phase applies the
default `zeroAccountsGuard`: it fails the run closed when `accountCount
=== 0`, a universally invalid post-login outcome that otherwise surfaces
as a silent empty scrape (e.g. Max's `403` or Yahav's BaNCS `93194`
leaving the account list empty). It keys on accounts only, never
transactions, so an empty-but-healthy account (OneZero / Pepper) stays
successful.

## Per-bank shape extractors

Each api-direct bank declares its own `IApiDirectScrapeShape`:

| Bank    | TXN query                          | Balance query                 | Source                                                                                                                                    |
| ------- | ---------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| OneZero | `GET_ACCOUNT_TRANSACTIONS` GraphQL | `GET_ACCOUNT_BALANCE` GraphQL | [`Banks/OneZero/scrape/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Banks/OneZero/scrape) |
| Pepper  | REST `/transactions`               | REST `/balance`               | [`Banks/Pepper/scrape/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Pepper/scrape)   |
| PayBox  | REST `/wallet/transactions`        | REST `/wallet/balance`        | [`Banks/PayBox/scrape/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Banks/PayBox/scrape)   |

The shape interface (`balanceVars`, `balanceExtract`, `txnVars`, `txnExtract`) is uniform; only the per-bank closures differ.

## urlTag resolution — WK token or inline literal URL

Each shape step (`customer`, `balance`, `transactions`) carries a `urlTag` of type `WKUrlOrLiteral` — either a Well-Known `WKUrlGroup` token resolved through the WK registry, or an absolute REST URL declared inline. Browser banks migrating to the hard-model post-auth path keep their whole API contract in one shape by wrapping each endpoint with `literalUrl(url)` (a branded `LiteralUrl`); GraphQL and Well-Known-registered banks keep using their `WKUrlGroup` token unchanged.

`resolveWkUrl` in [`UrlsWK.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Registry/WK/UrlsWK.ts) short-circuits on `isLiteralUrl(tag)` and returns the literal URL verbatim before the WK map lookup, so existing tokens resolve exactly as before.

## REST verb — GET vs POST

Each REST shape step carries an optional `method` of type `ScrapeHttpMethod` (`'GET' | 'POST'`). It defaults to `POST`, so every existing bank is unaffected. When a step sets `method: 'GET'`, `dispatchStep` routes it to `apiGet` with the resolved `urlTag` and sends **no** request body (GET carries its params in the path/query, built by the `urlTag` producer); `bodyTemplate` and `buildVars` are inert for that step. Banks whose whole contract is GET (e.g. the Discount/Titan family) declare `method: 'GET'` on all three steps. GraphQL steps (no `urlTag`) ignore `method` and keep routing through `apiQuery`.

## withBrowserApiDirect — wiring a browser bank to the hard model

`PipelineBuilder.withBrowserApiDirect(shape)` is the public builder entry point that swaps a browser bank's generic post-auth chain (AUTH-DISCOVERY / ACCOUNT-RESOLVE / DASHBOARD / generic SCRAPE / BALANCE-RESOLVE) for a single `API-DIRECT-SCRAPE` phase driven by the bank's `IApiDirectScrapeShape`, while keeping the browser login phases (INIT / HOME / PRE-LOGIN / LOGIN / OTP-\*) for WAF bypass. The hard-model calls dispatch through the **live login page** (`BrowserFetchStrategy`), so session cookies + the TLS/JA3 fingerprint ride every request for free.

## BaNCS session-capture contract (Yahav)

TCS BaNCS banks (Yahav) POST a large `MessageEnvelope` whose session-specific fields cannot be templated. A bank opts in with `bancsSessionCapture: true` in its `PipelineBankConfig`; at BIND, `primeBancsSession` scans the login-boot network pool and stashes an `IBancsCapture` on the mediator session-context:

| Field | Source | Rides |
| --- | --- | --- |
| `bancsSecToken` | pooled `/account` POST `SecToken` block | envelope `SecToken` |
| `bancsPortfolioIorId` / `bancsPortfolioId` | pooled `Prtflio.Id` | every Payload |
| `bancsAppVer` | pooled `AppVer` (per-deployment build string) | envelope version nodes |

Two request-header sniffs run alongside it (both PII-safe — only per-session auth material, never the credential body):

- **CSRF** (`scanCsrf`): value-matches the login response's `csrfTkn` nonce to the opaque request-header name the SPA's Angular interceptor injects, replayed on every `/account` POST (clears BaNCS error 88521).
- **SPA headers** (`scanSpaHeaders`): the SPA's custom XHR headers (`X-Requested-With` / `Accept`) captured from the pooled accounts request and replayed via the default-header bag (clears BaNCS error 93194 whose subject element is `origin`). The capture is best-effort: when the pooled request carried **no** recorded headers the sniff yields an empty bag, so `bancsHeaders` (`YahavShapeHeaders.ts`) falls back to a **deterministic static Angular-XHR set** (`X-Requested-With: XMLHttpRequest`, `Accept: application/json, text/plain, */*`) — a non-empty capture always wins. Without the fallback the empty-capture case intermittently drew the 93194 (zero accounts → zero transactions).

## Optional shape hooks

Beyond the three required steps (`customer` / `balance` / `transactions`), `IApiDirectScrapeShape` exposes optional hooks a bank declares only when needed:

- `customer.secondaryUrlTag` — a second identity GET fired after the primary customer fetch; its parsed response reaches `extractAccounts` as `secondaryBody` (FIBI account-type lookup).
- `customer.skipFetch` / `balance.skipFetch` — skip the network call entirely; the extractor still runs but with `body: {}` (PayBox `uId`-derived accounts; card-cycle banks' deterministic zero balance).
- `bodyTemplate` (per step) — a `JsonValueTemplate` hydrated against the post-login scope and POSTed as the request body (PayBox class-y `auth` envelopes).
- `signer` + `secrets` (shape root) — an `IAesSignerConfig` body-pointer signer applied to every scrape-step body before POST (PayBox).
- `resultGuard` — a fail-closed POST-stage guard over a PII-free `IApiDirectScrapeGuardSummary` that aborts a degraded run (e.g. zero transactions from a warm session).
- `bootstrap` — an `IApiDirectScrapeBootstrapStep` that runs **once before** the per-account scrape to seed the session context with material later steps need (PayBox's per-session HMAC key). See below.
- `isCardIssuer` — declares that this shape's rows are **card** transactions, so the mapper inverts the issuer's sign convention. See below.

## isCardIssuer — card amount signs

A card issuer reports a charge as a **positive** magnitude ("you owe 122.17"), the opposite of the account convention the canonical shape uses, where spend is negative. `isCardIssuer: true` (Amex, Isracard, Max, VisaCal) declares that convention on the shape; `ApiDirectScrapeActions.mapTxns` forwards it to `autoMapTransaction`, which routes **both** raw amounts — charged and original — through `signCardAmounts` (`Mediator/Scrape/TxnMapper/TxnSign.ts`). That function takes an `ICardSignArgs` (the two raw amounts plus the flag) and returns the resolved pair as `ISignedAmounts`.

The sign is inverted rather than forced, because forcing it (`-Math.abs`) turns a refund back into a charge — a charge and its later refund would both map to spend, so refunded money never returns.

Two issuer styles exist and one rule covers both:

| Issuer | how a refund row is signed |
| --- | --- |
| VisaCal | charged amount is an **unsigned** magnitude; only the original-currency amount carries the minus |
| Isracard / Amex | **both** amounts are already negative |

So a card row counts as a credit when **exactly one of its two amounts is negative** — a disagreement only a refund produces, since a refund is a refund in both currencies (Isracard proves it even on a foreign-currency refund, where the two amounts differ in magnitude and currency yet agree in sign). A negative value is unambiguous evidence of a credit, while a positive one cannot distinguish a charge from an unsigned magnitude, so the negative side wins. Both amounts are normalised negative before the inversion, which flips them back to positive for the refund and leaves ordinary charges negative. Rows whose fields already agree are untouched, so the rule is idempotent across both styles.

## Start-date window — honouring the caller's `startDate`

`ScraperOptions.startDate` means "give me transactions from this date onwards". Every shape formats it into the outbound request, but providers treat it as a **hint**, not a contract — and card issuers ignore it almost entirely. Isracard and Amex are queried per *billing cycle* (`startOf('month')` of `startDate`, walked forward to `now + futureMonthsToScrape`), and a cycle carries rows whose purchase date can be far older than the cycle itself: installments and out-of-statement charges. Measured against captured Isracard traffic, a 180-day request returned **15 months** of history — 61 of 239 rows predated the window.

The generic path had a client-side filter for exactly this (`filterAfterStart`, in `Strategy/Scrape/ScrapeData/ScrapeDataDedup.ts`), but no api-direct bank ever reached it: `withApiDirect` / `withBrowserApiDirect` short-circuit the builder straight to this phase, bypassing the legacy `Strategy/Scrape` chain. So the window was silently unenforced for all api-direct banks.

`applyStartWindow` (`Mediator/Scrape/StartWindow.ts`) closes that gap. `fetchAccountTxns` calls it immediately after `mapTxns`, passing an `IStartWindowArgs` (`txns`, `startDate`, `label`) and receiving an `IStartWindowResult` (`kept`, `dropped`).

Three deliberate choices:

| Choice | Why |
| --- | --- |
| **Lower bound only** | `futureMonthsToScrape` means callers explicitly request charges dated after today — VisaCal's newest billing date sits two weeks past the run date. An upper bound would delete data the caller asked for. |
| **Filters on `date`** | Isracard exposes no distinct billing-date field, so its mapped `processedDate` is a copy of `date`. Windowing on `processedDate` would be identical there and inconsistent across banks. |
| **A missing bound passes rows through** | Deleting every row because a test fixture omitted `startDate` would turn a fixture gap into silent data loss — the exact failure this phase's guardrails exist to catch. |
| **An undated row passes through** | `filterAfterStart` compares `NaN >= startMs`, which is always false, so a row whose date the mapper could not parse is dropped without trace. A row we cannot classify has not been *proven* out of window, so the window fails open and leaves it to the mapper-reject counter. This is why the legacy helper is deliberately not reused. "Undated" also covers the epoch sentinel: `ITransaction.date` is a required ISO string with no representation for "unknown", so a mapper facing an unreadable value must invent one (see PayBox's `dateOf`), and no real transaction or caller `startDate` predates 1970. |

The log line is `debug`, not `warn`: card issuers trim rows on every run, so a warning would fire forever and train reviewers to ignore it. The one actionable case — a window that removes *every* row, meaning either a mistaken `startDate` or dates the mapper failed to parse — does warn.

This pairs with the [coverage audit](../observability/coverage-audit.md): the audit proves the shape read every container the response carried, and the window proves the caller receives only what it asked for. Both are needed — on Isracard the container fix recovers 52 in-window rows (49% of the caller's requested data) that the pre-fix shape silently dropped.

## Duplicate collapse — opt-in, and only when redundancy is proven

`fetchPaginated` concatenates pages blindly, so a provider that ignores the cursor and re-serves a page emits every row on it twice. PayBox solves that inside its own cursor logic; nothing solves it generically.

`collapseDuplicates` (`Mediator/Scrape/TxnDedup.ts`) is the generic mechanism, and it is **off unless a shape declares `transactions.dedupKeyFields`**. `refineTxns` passes an `IDedupArgs` (`txns`, `keyFields`, `label`) and receives an `IDedupResult` (`kept`, `collapsed`, `collisions`). **No bank declares a key today**, so behaviour is unchanged for all of them.

That default is not caution for its own sake — it is what the captured traffic showed. Neither obvious key is safe:

| Candidate key | Measured result |
| --- | --- |
| `identifier` | Not unique. Beinleumi repeats one identifier across **33 of 42** distinct rows; Leumi and Yahav repeat theirs too. Collapsing on it would have deleted most of a Beinleumi statement. |
| `date` + `chargedAmount` + `description` | Collides on genuinely distinct rows — Isracard and Amex each carry one such pair. Two identical coffees on the same day are two transactions, not one. |

So a declared key only nominates candidates. A row is removed **only when its key *and* its full content match a row already kept**. A key that matches while the content differs is a mis-declared key: the row is kept and `collisions` rises, which warns. Nothing is lost while a wrong key is in place — but the warning says the collapse cannot be trusted and the key must be corrected or withdrawn.

Reproduce those measurements before declaring a key for a bank.

## bootstrap — one-shot session-context seeding

Some api-direct banks cannot sign their first data call until an
**unsigned** exchange call hands back per-session key material. The
optional `bootstrap` hook runs a single dispatch before the account
walk and merges its result into the mediator session context.

`buildBootstrapDispatchArgs` turns the step's shape into the same
dispatch args the scrape steps use (so the bootstrap call rides the
identical transport). The step's `extractPatch(args: IBootstrapExtractArgs)`
reads the response body plus the current context and returns a
`Procedure<SessionContextPatch>` — a procedure carrying the partial
context that the phase read-merges onto the live session context,
preserving `uId` / `token` / `deviceId16Hex` while adding the new
material. The extract is fail-closed: a missing or malformed exchange
response aborts the run rather than scraping unsigned.
