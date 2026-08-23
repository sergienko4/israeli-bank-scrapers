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
| `.post`   | Forensic audit — emits the per-account `--- Account <masked> \| <N> txns ---` line via `logForensicAudit`, then runs the optional **result guard** (see below).                                                                                                                                                                                                           |
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

## Shared family shapes — one contract, several brands

Some banks are not independent institutions but **brands of one bank running one portal**. The four First-International brands (Beinleumi, Massad, Pagi, OtsarHahayal) all serve the same Mataf/`appsng` BFF: the same `userData` identity GET, the same `accountType` lookup, the same `balances/{type}` path, the same single full-window `POST .../transactions/list` envelope. Only the origin differs.

Declaring that contract once per brand means a wire change has to land four times, and a fix applied to three of the four drifts silently. So the family contract lives in one neutral factory — [`Phases/ApiDirectScrape/FibiGroup/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectScrape/FibiGroup) — and each brand declares only what is genuinely its own.

`makeFibiGroupShape` takes an `IFibiGroupShapeArgs` and returns the assembled `IApiDirectScrapeShape`. The factory owns everything origin-independent: the request envelope, the two-GET identity merge over `IFibiAcct`, and the response extractors. The brand supplies its step name, its four origin-bound URL producers, and its own `windowNarrowing` stance. The URL producers are built from an `IFibiGroupConfig` — one per brand (`MASSAD_CONFIG`, `PAGI_CONFIG`, `OTSAR_HAHAYAL_CONFIG`, `BEINLEUMI_CONFIG`) — which carries nothing but the post-login origin.

Two constraints shape that split, and both are load-bearing:

- **The factory lives under `Phases/`, not `Banks/`.** Two gates enumerate directories under `Banks/` and treat each one as a bank (`CheckBankIntegrationCoverage`, `WindowDeclaredCanary`); a shared folder there would be mistaken for a fifth brand. `Phases/` also inherits the same ESLint size caps, so the move costs no guardrail strength.
- **`windowNarrowing` is passed in, never inherited.** Each brand keeps declaring its own backfill stance in its own `scrape/` folder, where the WINDOW-CANARY gate scans for it — a shared default would turn a conscious per-bank decision into an invisible one.

**No bank imports another bank.** A brand depends on the neutral factory; never on a sibling. The values that cross module boundaries are branded (`FibiUid` for the per-request cache-busting GUID, `FibiAccountBalance`, `FibiAccountNumberDisplay`) so a raw string cannot be substituted for a parsed one.

The pattern generalises: any set of brands sharing one portal belongs behind one family factory on these terms.

## Shared card-issuer cursor — one calendar walk, four issuers

The four card issuers (Amex, Isracard, Max, VisaCal) do not page by an opaque server token. They page by **billing month**, walking the scrape window one month at a time. That walk is the *fallback* path: when the billing-cycle catalog detector resolves a real cycle catalog, SCRAPE uses it instead and these helpers are not consulted.

Each issuer previously kept a private copy of the same arithmetic, so the walk now lives once in [`Phases/ApiDirectScrape/CardIssuer/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectScrape/CardIssuer).

`startMonth` floors the window start to the first of its month. `offsetOf` maps the `TMonthCursor` pagination cursor — `false` on the first call, otherwise a 0-based month offset — onto a branded `TMonthOffset`. `monthAt` resolves the target month, and `billingMonthAt` renders the branded `TBillingMonth`, the composite `01/MM/YYYY` form that the Amex and Isracard request bodies carry. `lastOffset` computes the highest in-window offset, and `nextCursorOf` advances the cursor until that ceiling is reached.

Three constraints shape the split, and all three are load-bearing:

- **The module is named `*ShapeTxns.ts` under `Phases/ApiDirectScrape/`.** That path is what keeps it inside the window-end ESLint rule's glob, which bans reading the clock and forces the bound to come from `scrapeWindowEnd(ctx)`. A shared module outside the glob would silently opt out of the coverage backfill and re-introduce the transaction loss the backfill exists to close.
- **The open-cycle floor is an optional argument, not a defaulted `0`.** `getFutureMonths` does not clamp, and `futureMonthsToScrape` is an unconstrained public option, so a negative value reaches the walk. Flooring at `0` would *widen* the window for the three unfloored issuers rather than preserve their behaviour; omitting the floor passes the request through untouched.
- **The ceiling is passed to `nextCursorOf`, never recomputed inside it.** VisaCal floors its walk at one month because CAL indexes a billing month by its *debit* date, so a purchase made today belongs to next month's cycle. Taking the ceiling as an argument lets that divergence live at VisaCal's call site instead of becoming a branch in shared code.

## urlTag resolution — WK token or inline literal URL

Each shape step (`customer`, `balance`, `transactions`) carries a `urlTag` of type `WKUrlOrLiteral` — either a Well-Known `WKUrlGroup` token resolved through the WK registry, or an absolute REST URL declared inline. Browser banks migrating to the hard-model post-auth path keep their whole API contract in one shape by wrapping each endpoint with `literalUrl(url)` (a branded `LiteralUrl`); GraphQL and Well-Known-registered banks keep using their `WKUrlGroup` token unchanged.

`resolveWkUrl` in [`UrlsWK.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Registry/WK/UrlsWK.ts) short-circuits on `isLiteralUrl(tag)` and returns the literal URL verbatim before the WK map lookup, so existing tokens resolve exactly as before.

## REST verb — GET vs POST

Each REST shape step carries an optional `method` of type `ScrapeHttpMethod` (`'GET' | 'POST'`). It defaults to `POST`, so every existing bank is unaffected. When a step sets `method: 'GET'`, `dispatchStep` routes it to `apiGet` with the resolved `urlTag` and sends **no** request body (GET carries its params in the path/query, built by the `urlTag` producer); `bodyTemplate` and `buildVars` are inert for that step. Banks whose whole contract is GET (e.g. the Discount/Titan family) declare `method: 'GET'` on all three steps. GraphQL steps (no `urlTag`) ignore `method` and keep routing through `apiQuery`.

## withBrowserApiDirect — wiring a browser bank to the hard model

`PipelineBuilder.withBrowserApiDirect(shape)` is the public builder entry point that swaps a browser bank's generic post-auth chain (AUTH-DISCOVERY / ACCOUNT-RESOLVE / DASHBOARD / generic SCRAPE / BALANCE-RESOLVE) for a single `API-DIRECT-SCRAPE` phase driven by the bank's `IApiDirectScrapeShape`, while keeping the browser login phases (INIT / HOME / PRE-LOGIN / LOGIN / OTP-\*) for WAF bypass. The hard-model calls dispatch through the **live login page** (`BrowserFetchStrategy`), so session cookies + the TLS/JA3 fingerprint ride every request for free.

## BaNCS session-capture contract (Yahav)

TCS BaNCS banks (Yahav) POST a large `MessageEnvelope` whose session-specific fields cannot be templated. A bank opts in with `bancsSessionCapture: true` in its `PipelineBankConfig`; at BIND, `primeBancsSession` scans the login-boot network pool and stashes an `IBancsCapture` on the mediator session-context:

| Field                                      | Source                                        | Rides                  |
| ------------------------------------------ | --------------------------------------------- | ---------------------- |
| `bancsSecToken`                            | pooled `/account` POST `SecToken` block       | envelope `SecToken`    |
| `bancsPortfolioIorId` / `bancsPortfolioId` | pooled `Prtflio.Id`                           | every Payload          |
| `bancsAppVer`                              | pooled `AppVer` (per-deployment build string) | envelope version nodes |

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

| Issuer          | how a refund row is signed                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------ |
| VisaCal         | charged amount is an **unsigned** magnitude; only the original-currency amount carries the minus |
| Isracard / Amex | **both** amounts are already negative                                                            |

So a card row counts as a credit when **exactly one of its two amounts is negative** — a disagreement only a refund produces, since a refund is a refund in both currencies (Isracard proves it even on a foreign-currency refund, where the two amounts differ in magnitude and currency yet agree in sign). A negative value is unambiguous evidence of a credit, while a positive one cannot distinguish a charge from an unsigned magnitude, so the negative side wins. Both amounts are normalised negative before the inversion, which flips them back to positive for the refund and leaves ordinary charges negative. Rows whose fields already agree are untouched, so the rule is idempotent across both styles.

## Start-date window — honouring the caller's `startDate`

`ScraperOptions.startDate` means "give me transactions from this date onwards". Every shape formats it into the outbound request, but providers treat it as a **hint**, not a contract — and card issuers ignore it almost entirely. Isracard and Amex are queried per _billing cycle_ (`startOf('month')` of `startDate`, walked forward to `now + futureMonthsToScrape`), and a cycle carries rows whose purchase date can be far older than the cycle itself: installments and out-of-statement charges. Measured against captured Isracard traffic, a 180-day request returned **15 months** of history — 61 of 239 rows predated the window.

The generic path had a client-side filter for exactly this (`filterAfterStart`, in `Strategy/Scrape/ScrapeData/ScrapeDataDedup.ts`), but no api-direct bank ever reached it: `withApiDirect` / `withBrowserApiDirect` short-circuit the builder straight to this phase, bypassing the legacy `Strategy/Scrape` chain. So the window was silently unenforced for all api-direct banks.

`applyStartWindow` (`Mediator/Scrape/StartWindow.ts`) closes that gap. `refineTxns` applies it as the last step of refinement — after `mapTxns`, after the map-reject report, and after any duplicate collapse — passing an `IStartWindowArgs` (`txns`, `startDate`, `label`) and receiving an `IStartWindowResult` (`kept`, `dropped`).

Three deliberate choices:

| Choice                                  | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lower bound only**                    | `futureMonthsToScrape` means callers explicitly request charges dated after today — VisaCal's newest billing date sits two weeks past the run date. An upper bound would delete data the caller asked for.                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Filters on `date`**                   | Isracard exposes no distinct billing-date field, so its mapped `processedDate` is a copy of `date`. Windowing on `processedDate` would be identical there and inconsistent across banks.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **A missing bound passes rows through** | Deleting every row because a test fixture omitted `startDate` would turn a fixture gap into silent data loss — the exact failure this phase's guardrails exist to catch.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **An undated row passes through**       | `filterAfterStart` compares `NaN >= startMs`, which is always false, so a row whose date the mapper could not parse is dropped without trace. A row we cannot classify has not been _proven_ out of window, so the window fails open and leaves it to the mapper-reject counter. This is why the legacy helper is deliberately not reused. "Undated" also covers the epoch sentinel: `ITransaction.date` is a required ISO string with no representation for "unknown", so a mapper facing an unreadable value must invent one (see PayBox's `dateOf`), and no real transaction or caller `startDate` predates 1970. |

The log line is `debug`, not `warn`: card issuers trim rows on every run, so a warning would fire forever and train reviewers to ignore it. The one actionable case — a window that removes _every_ row, meaning either a mistaken `startDate` or dates the mapper failed to parse — does warn.

This pairs with the [coverage audit](../observability/coverage-audit.md): the audit warns when rows discoverable in the response are missing from the shape's output, and the window proves the caller receives only what it asked for. Both are needed — on Isracard the container fix recovers 52 in-window rows (49% of the caller's requested data) that the pre-fix shape silently dropped.

## Window upper bound — `scrapeWindowEnd` and the `windowNarrowing` declaration

The lower bound comes from the caller. The **upper** bound was, until now, decided twelve separate times: each `*ShapeTxns.ts` read the clock itself and encoded "today" in its own wire format — `YYYYMMDD` in a Hapoalim query string, RFC-1123 inside Leumi's JSON-in-a-string body, a `{Day,Month,Year}` triple in Yahav's filter, `DD/MM/YYYY` for the card issuers. That made the bound unreachable from outside the shape, so once the [coverage audit](../observability/coverage-audit.md) reported a gap, nothing could ask the provider for an older slice.

The bound now lives on `IActionContext.windowEnd` (an `Option<Date>`) and is read through a single accessor, `scrapeWindowEnd` (`Mediator/Scrape/ScrapeWindowEnd.ts`), which falls back to `new Date()` when no bound is named. The accessor normalises an absent slot to `none()` rather than requiring every context builder to set one, mirroring `ApiMediatorAccessor.readSlot`: a context that never mentions a bound _is_ an unbounded one. The field itself stays required on the interface so the compiler keeps enumerating production builders. An ESLint rule (`eslint.config.mjs` §20) plus a canary stop a thirteenth shape from reading the clock again. `OneZeroShapeTxns` is the one exclusion, and it is not an upper bound at all: it clamps the window's _start_ to the provider's absolute one-year floor, which must stay pinned to wall-clock now.

Moving the bound only helps where it reaches the wire, so every shape declares `transactions.windowNarrowing` — a claim about what a narrower bound would actually change:

| Stance              | Banks                                                                 | Meaning                                                                                                                           |
| ------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `windowEnd`         | Hapoalim, Beinleumi, Massad, OtsarHahayal, Pagi, Leumi, Pepper, Yahav | The bound reaches the request. A gap can be closed by re-asking with an earlier end.                                              |
| `periodEnumeration` | Isracard, Amex, Max, VisaCal                                          | The request names a fixed provider **billing period**, derived from `startDate`. The bound only decides how many periods to walk. |
| `lowerBoundOnly`    | Discount, Mercantile                                                  | The provider accepts no upper bound at all.                                                                                       |
| `providerCursor`    | OneZero, PayBox                                                       | The walk is driven by a provider cursor, not by dates.                                                                            |

A declaration is worth exactly as much as the test behind it, so `WindowNarrowing.test.ts` builds each bank's real request twice under two different bounds and compares the bytes — in both directions, so a bank cannot be quietly under-claimed either.

Two findings from writing that contract are worth keeping:

- **A stance is a claim about the whole walk, not one request.** Yahav was nearly mis-declared: it always opens at chunk 0, so its _first_ request is byte-identical under any bound. Its chunk _list_ does shrink. The contract therefore samples cursor positions across the walk rather than probing the first call.
- **`periodEnumeration` has no narrower re-ask.** A billing month cannot be subdivided, so a gap _inside_ one month has no follow-up request that would close it. This includes Isracard and Amex — for them, correct container extraction and honest reporting are the whole remedy, and the backfill path must not pretend otherwise.

## Coverage backfill — asking again for the slice that did not arrive

The coverage audit deliberately calls a shortfall `unproven`, never `truncated`, because one response cannot tell a quiet account from a capped one. Only a second request can. `collectAccountRows` (`Phases/ApiDirectScrape/ApiDirectScrapeBackfill.ts`) owns that loop: it runs the normal paginated walk, assesses what arrived, and — when the bank's declared stance allows it — narrows `ctx.windowEnd` and walks again.

The decision itself is one function, `planBackfill` (`Mediator/Scrape/WindowBackfill.ts`), which returns an `IBackfillPlan` (`shouldAsk`, `nextEnd`, `reason`) from an `IBackfillPlanArgs` bundle. It decides and reports in one step — it reads the kill-switch below from the environment and logs the outcome, so it is deliberately not a pure function; a decision an operator cannot see in the log is worse than no decision. It refuses in a fixed order, and the reason is logged either way — "we asked and could not get more" and "we never asked" are different facts:

1. `WINDOW_BACKFILL=off` — operator kill-switch. Any other value leaves backfill on, so a typo cannot silently disable it.
2. The window is already covered.
3. No row carried a usable date, so there is no bound to derive.
4. The stance cannot be narrowed. The reason comes from `BACKFILL_EXCLUSION` (`Types/WindowNarrowing.ts`), a map over `UnbackfillableStance` rather than a branch, so adding a stance is a compile error instead of a bank that silently drops out.
5. `MAX_BACKFILL_ASKS` (12, one per month of the longest supported window) has been reached.

Otherwise the next bound is the **end of the oldest day held** — inclusive, so that day is asked for again. The exclusive bound this replaced (the day _before_ the oldest row) assumed provider truncation is day-aligned. It is not: a bank that caps by row count can hand back the first `N` rows of a day and withhold the rest, and a bound set before that day makes those withheld rows unreachable for good. Re-asking the day costs the rows already held being re-served, which `dropOverlap` removes below.

**The loop's termination guarantee survives that change:** if the re-ask yields nothing genuinely new, `oldest` stays where it was, the same bound is derived again, and a bound that does not move strictly backwards stops the walk. No separate zero-progress counter is needed. The bound is set to the _end_ of the day rather than its start because one bank — Leumi — encodes the bound as an instant (RFC 1123) rather than a date; for every other bank both render identically under `YYYYMMDD`.

One case stays out of reach by construction: a **single day holding more rows than the provider's page cap**. No date bound can split a day, so narrowing cannot recover it. That is a reporting problem, not a narrowing one.

Providers answer in whole periods, so a narrowed request routinely re-serves rows the previous one already delivered. `dropOverlap` (`Mediator/Scrape/RawOverlap.ts`) removes them, returning an `IOverlapResult` from an `IOverlapArgs` bundle. It is a **multiset** difference on the raw row, not a set difference: a row is dropped only while an unconsumed byte-identical copy is still held. Two genuinely distinct purchases can serialize identically — same day, same merchant, same amount — and a set difference would delete one of them silently. This is narrower than [duplicate collapse](#duplicate-collapse--opt-in-and-only-when-redundancy-is-proven) on purpose: there the redundancy is the provider's and needs a declared key; here we caused it by asking twice, so identity is the whole test.

The coverage assessment runs **per account**, not per page, and on the raw rows before the start-window trims them. Per page it would fire on almost every page of every card issuer by construction — an August page cannot reach a February start — and after trimming it would be circular, since trimming is precisely what guarantees nothing predates the start.

For a quiet `windowEnd` account whose rows genuinely stop short of `startDate`, the loop spends exactly one extra request: it comes back with nothing older, the bound fails to move, and the walk ends logging `bound did not move`. That request is the point — it is what distinguishes a quiet account from a capped one, which a single response never can.

A shape may also walk backwards on its own, using a cap the bank states in the response — [Hapoalim](../banks/hapoalim.md#truncated-transaction-windows) does. A shape-level walk is the more precise of the two where a bank declares a cap, because it never spends the probe request on a quiet account; the generic loop is the floor beneath every bank that declares nothing.

The two do **not** compose safely by default, and it is worth being blunt about why. A shape walk reaches past `startDate` on its own, so the window afterwards assesses as `covered` and `planBackfill` asks for nothing — the generic loop is masked. Anything the shape walk lost is therefore lost for the run. That is not a reason to remove either mechanism; it is the reason a shape that walks its own pages must declare `pagesMayOverlap: true`, which makes each page boundary an inclusive re-ask joined by `dropOverlap` (see [Hapoalim](../banks/hapoalim.md#truncated-transaction-windows)). A shape that walks pages under an exclusive boundary and declares nothing is silently trusting its own walk to be lossless.

Two limits are worth stating plainly, because neither raises an error:

- **A `covered` verdict is not a guarantee the bank never truncates.** It says the rows in hand reach the requested start on this run. An account quiet enough to fit under a provider's cap will read `covered` every time until it is not.
- **`periodEnumeration` gaps are reported, not closed.** The loop refuses with the bank's own reason and the shortfall stays in the log rather than being silently absorbed.

### Where the audit cannot see

The audit reads the rows a shape returns. Two known cases sit upstream of that, so a gap there is invisible to it:

- **Leumi double-encodes its payload.** Transactions arrive as a JSON string inside the `jsonResp` field rather than as JSON. A parse that fails, or a schema drift inside that inner string, yields zero rows — which the audit reports as an empty account, indistinguishable from an account that genuinely had no activity.
- **A provider may hold less than the caller asks for.** OneZero refuses movements older than roughly a year, so its walk stops at that floor and a caller asking for two years receives one. The floor is a property of the provider, fixed against the current date, so it is measured from the wall clock and deliberately exempt from ESLint §20 — measuring it from a narrowed window end would push it earlier than the provider actually serves. The shortfall is reported by the audit and refused by `planBackfill` with OneZero's `providerCursor` reason: reported, not closed.

A canary (`WindowDeclaredCanary.test.ts`) keeps the cross-bank contract from drifting behind the product: every bank declaring a stance in the source tree must appear in it. ESLint §20 covers the other half, keeping a shape's window bound tied to `scrapeWindowEnd(ctx)`.

## Duplicate collapse — opt-in, and only when redundancy is proven

`fetchPaginated` joins pages with a `PageMerge` — a two-argument function over the accumulated rows and the page just fetched. Its default is `concatPages` (`Strategy/Fetch/Pagination.ts`), which appends blindly, so under that default a provider that ignores the cursor and re-serves a page emits every row on it twice. A shape declaring `pagesMayOverlap: true` gets `buildOverlapMerge` (`Mediator/Scrape/OverlapMerge.ts`) instead, which runs each page through `dropOverlap` against the rows already held — the same multiset difference the backfill re-ask uses, applied at every page boundary rather than once at the end. PayBox solves the problem a third way, inside its own cursor logic.

The paginator also halts on a **repeated cursor**: if a provider hands back the cursor it was just given, the walk stops and keeps what it has rather than spinning to `MAX_PAGES`. The guard is cursor identity and not accumulator length on purpose — Yahav walks month chunks and an empty month is legitimate, so a length-based guard would truncate it at the first quiet month.

`MAX_PAGES` behind it is a runaway backstop, not a budget, and is sized so it cannot fire on legitimate work. That sizing matters because of which end it truncates: month-chunked shapes walk **oldest-first**, so a walk cut short at the ceiling loses the most **recent** months — and the window guardrails would not report it, because they assert the old end of the range against `startDate`. At 300 a month-chunked walk spans 25 years, beyond any Israeli bank's retention, while a genuine non-terminating walk still stops. A ceiling halt is always a WARN naming the reason and the row count.

`collapseDuplicates` (`Mediator/Scrape/TxnDedup.ts`) is the generic mechanism, and it is **off unless a shape declares `transactions.dedupKeyFields`**. `refineTxns` passes an `IDedupArgs` (`txns`, `keyFields`, `label`) and receives an `IDedupResult` (`kept`, `collapsed`, `collisions`). **No bank declares a key today**, so behaviour is unchanged for all of them.

That default is not caution for its own sake — it is what the captured traffic showed. Neither obvious key is safe:

| Candidate key                            | Measured result                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identifier`                             | Not unique. Beinleumi repeats one identifier across **33 of 42** distinct rows; Leumi and Yahav repeat theirs too. Collapsing on it would have deleted most of a Beinleumi statement. |
| `date` + `chargedAmount` + `description` | Collides on genuinely distinct rows — Isracard and Amex each carry one such pair. Two identical coffees on the same day are two transactions, not one.                                |

So a declared key only nominates candidates. A row is removed **only when its key _and_ its full content match a row already kept**. A key that matches while the content differs is a mis-declared key: the row is kept and `collisions` rises, which warns. Nothing is lost while a wrong key is in place — but the warning says the collapse cannot be trusted and the key must be corrected or withdrawn.

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
