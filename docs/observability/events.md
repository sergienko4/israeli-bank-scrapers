# Structured events

Every phase emits structured Pino records. Each record carries an `event` field (kebab-case dotted scope) plus phase-specific fields. All fields go through `PiiRedactor` before write.

## Common fields

| Field | Type | Notes |
|---|---|---|
| `event` | string | `<phase>.<action>.<outcome>` — e.g. `balance-resolve.fetch.start` |
| `correlationId` | string | `randomUUID()` per phase invocation — correlates `.start` / `.success` / `.failure` records |
| `module` | string | Module/logger name — kebab-cased from `import.meta.url` basename (e.g. `balance-resolve-actions`) or an explicit name passed to `getDebugByName`. NOT the phase name. |
| `bankAccountTail4` | string | `***NNNN` — last-4 of a bankAccountUniqueId, never the full id |

## Per-phase events

### INIT

| Event | Level | Fired when |
|---|---|---|
| `init.browser.launched` | info | Camoufox + context + page ready |
| `init.navigation.complete` | info | First nav to `loginUrl` returned |
| `INIT-ACTION-NAV-FAILURE` | warn | `executeNavigateToBank` failed — full transport-layer envelope, see [INIT navigation forensics](init-navigation-forensics.md). **Naming exception:** predates the `phase.action.outcome` lowercase contract; kept UPPER-KEBAB so existing log dashboards and grep aliases continue matching while the forensics envelope stabilises. |

### LOGIN

| Event | Level | Fired when |
|---|---|---|
| `login.field.resolved` | debug | One credential field resolved via SelectorResolver |
| `login.submit` | info | Submit button clicked |
| `login.result.invalid_password` | warn | Bank returned credentials-wrong |
| `login.result.success` | info | Post-submit page recognised as authenticated |
| `login.completion` | debug | Advisory completion snapshot composed at LOGIN.final (see below) |
| `login.completion.error` | debug | A completion probe threw; snapshot stays neutral |

#### LOGIN completion observer (advisory)

At `LOGIN.final` an advisory observer composes three **LOGIN-LOCAL** signals
— is a loading spinner still visible, is an error banner present, and has the
page advanced past the login URL — into one snapshot and logs it as
`login.completion`. The verdict is **computed and logged only**; it does not
gate the phase, so behaviour is byte-identical for every bank. Its purpose is
to surface, per bank in the CI logs, the case where a login lingers on a
spinning form yet still passes the lenient cookie gate.

- `observeLoginCompletion(input)` — the entry facade wired into `LOGIN.final`.
  It runs the existing LOGIN post-gates first; if those already fail it returns
  a neutral snapshot and emits nothing.
- `captureCompletionSignals(ports)` — the phase-agnostic composer (under
  `Mediator/Completion`). It reads an `ICompletionPorts` contract and returns an
  `ICompletionSignals` snapshot (`spinnerVisible`, `hasError`, `advanced`).
- `buildLoginCompletionPorts(...)` — the LOGIN adapter that binds that contract
  to login-local probes: the spinner probe is `buildIsLoadingVisible` (the
  phase-neutral loading well-known), the error probe reuses the existing frame
  scan, and the advanced probe reuses the existing login-URL helper. It never
  probes dashboard state — that REVEAL belongs to AUTH-DISCOVERY.

### OTP-TRIGGER / OTP-FILL

| Event | Level | Fired when |
|---|---|---|
| `otp-trigger.sent` | info | Bank dispatched SMS/email |
| `otp-fill.retriever.invoked` | info | `otpCodeRetriever` callback called |
| `otp-fill.submit` | info | Code submitted |
| `otp-fill.result.invalid` | warn | Wrong/expired code |

### AUTH-DISCOVERY

| Event | Level | Fired when |
|---|---|---|
| `auth-discovery.scan.start` | debug | Pool scan begins |
| `auth-discovery.token.found` | info | Auth signal extracted |

### ACCOUNT-RESOLVE

| Event | Level | Fired when |
|---|---|---|
| `account-resolve.discovery.fetched` | info | Discovery call returned |
| `account-resolve.ids.count=N` | info | N account ids parsed |

### DASHBOARD

| Event | Level | Fired when |
|---|---|---|
| `dashboard.ui.click` | info | Dashboard affordance clicked |
| `dashboard.endpoint.detected` | info | Txn endpoint URL identified |
| `dashboard.halt.<gate>` | error | F-DASH-1 / F-DASH-2 / F-DASH-3 |

### SCRAPE

| Event | Level | Fired when |
|---|---|---|
| `scrape.pre.priming.start` | debug | Forensic priming starting |
| `scrape.account.start` | info | Per-account iteration begins |
| `scrape.account.complete` | info | Per-account walk done |
| `scrape.post.empty-gate.<verdict>` | info/warn | Empty-gate heuristic outcome |
| `--- Account *** | N txns ---` | info | Forensic audit line — see [Forensic audit](forensic-audit.md) |

### BALANCE-RESOLVE

| Event | Level | Fired when |
|---|---|---|
| `balance-resolve.fetch.start` | info | Each live fetch begins (one per plan entry) |
| `balance-resolve.fetch.success` | info | Fetch returned successfully |
| `balance-resolve.fetch.failure` | warn | Quarantined per-fetch failure |
| `balance-resolve.post resolved=N missed=M total=K` | debug | Partition outcome |
| `balance.miss` | warn | One per missed account (under `.post`) |
| `balance-resolve.final` | info | REVEAL log emitted with `resolvedCount`, `missedCount`, `totalCount` |

### TERMINATE

| Event | Level | Fired when |
|---|---|---|
| `terminate.cleanup.page` | debug | Page closed |
| `terminate.cleanup.context` | debug | Context closed |
| `terminate.cleanup.browser` | debug | Browser closed |
| `Result: success=<bool> | errorType=<type>` | info | Final outcome line |

## Reading the log

```sh
# Watch the live log
tail -f pipeline.log | jq .

# Find all BALANCE-RESOLVE events for a run
grep "balance-resolve" pipeline.log | jq .

# Find every fetch quarantine
jq -c 'select(.event == "balance-resolve.fetch.failure")' pipeline.log
```

## Per-module loggers

Every Pipeline module obtains a Pino child logger derived from its file
path so each event record carries an accurate `module` field without
hand-maintained string constants:

- `getDebug(import.meta.url)` — the default form, used by every Pipeline
  module. The basename of the URL (e.g. `BalanceResolveActions.ts`) is
  kebab-cased into the logger name (`balance-resolve-actions`).
- `getDebugByName(name)` — the explicit-name escape hatch for cases
  where the logger name has to be dynamic at construction time
  (notably `BaseScraper` keying loggers by `companyId`). The legacy
  `Common/Debug.js` shim re-exports this as its `getDebug` so historic
  string-keyed callers keep working without churn.

Both helpers route through the same lazy-resolved root logger, so
`PiiRedactor` always intercepts before any transport writes — see
[PII redaction](redaction.md) for the censor pipeline.

## Logger cluster anatomy

The pipeline's logger primitives live in `src/Scrapers/Pipeline/Logging/`
(extracted from the legacy `Types/Debug.ts` blob during Phase 12c). Each
file owns one concern so the moving parts are independently testable:

- `Logging/Debug.ts` — public facade. Exports `getDebug`,
  `getDebugByName`, and the `ScraperLogger` type alias used as the
  return-type shorthand for pino's `Logger` across the pipeline.
- `Logging/LoggerNaming.ts` — pure `deriveLogName(import.meta.url)`
  transform that strips the URL down to a kebab-cased module name; the
  return type is branded as `LoggerNameKebab` so consumers can't pass a
  raw string back into a slot that expects an already-derived name.
- `Logging/BankContext.ts` — `runWithBankContext(bank, fn)` opens an
  async-local scope; `getBankMixin` is the pino `mixin` callback that
  merges that scope plus the active phase / stage / runId onto every
  log line; `getActiveLogContext` is a read-only accessor over the same
  record so tests can assert the mixin contract directly without
  depending on transport-flush timing.
- `Logging/RootLogger.ts` — `getRootLogger` builds (or returns the
  cached) pino root the first time any child logger is read; the
  companion `isRootLoggerCached` predicate lets the deferred-resolve
  proxy decide whether the resolved child can be memoised yet or has
  to keep resolving fresh until `setActiveBank` lands.
- `Logging/ChildLoggerProxy.ts` — `buildDeferredLogger(name)` returns
  the lazy-resolve `Proxy` that backs both `getDebug` and
  `getDebugByName`. The internal `IProxyHandler` type documents the
  exact `get`-trap shape so the cluster's unit tests can assert
  property-access semantics without re-deriving it from `Proxy<T>`.
