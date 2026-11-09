# Structured events

The HTTP-only pipeline emits structured Pino records for
`api-direct-call` and `api-direct-scrape`. Stage records use
`event: "phase-stage"`; other records may use structured fields and a
`message` rather than an `event` discriminator. All records pass through
the central redaction pipeline before write.

## Common fields

| Field    | Type   | Notes                                                                               |
| -------- | ------ | ----------------------------------------------------------------------------------- |
| `bank`   | string | Active bank's async-local context                                                   |
| `phase`  | string | `api-direct-call` or `api-direct-scrape` during phase execution                     |
| `stage`  | string | `PRE`, `ACTION`, `POST` or `FINAL`                                                  |
| `runId`  | string | Per-process run stamp; also names the trace folder when enabled                     |
| `module` | string | Logger/module identifier; typically derived from the module URL, not the phase name |
| `event`  | string | Present on discriminated events, including `phase-stage`                            |

### Phase-stage records

Every phase emits one record per sub-step (`PRE` / `ACTION` / `POST` / `FINAL`) carrying `phase`, `stage`, and a `result` tag. A failing stage additionally carries the reason, so a red run is diagnosable from the log alone:

| Field          | Type   | Notes                                                                                           |
| -------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `result`       | string | `OK` / `FAIL` — the outcome tag (uppercase, as emitted by `traceTag`)                           |
| `errorType`    | string | Present only on failure. The `ScraperErrorTypes` member from the underlying `IProcedureFailure` |
| `errorMessage` | string | Present only on failure. Masked through `maskVisibleText` before write                          |

`traceReason` produces the two failure fields and returns an empty object on success, so callers spread it unconditionally. Before it existed a `fail` tag was terminal but silent — the log said a stage failed and nothing more.

## Lifecycle and scrape records

| Record                                              | Level | Meaning                                                 |
| --------------------------------------------------- | ----- | ------------------------------------------------------- |
| `phase`, `action: START`, `index`                   | debug | A phase begins                                          |
| `phase`, `action: OK` or `FAIL`, `index`            | debug | A phase finishes                                        |
| `event: phase-stage`, `phase`, `stage`, `result`    | debug | One stage completes; failure includes the masked reason |
| `message: api-direct-scrape.post`                   | debug | Scrape POST begins                                      |
| `--- Account <redacted> \| N txns ---` in `message` | info  | Per-account transaction count                           |
| Redacted transaction preview in `message`           | debug | Dates and centrally redacted amount/merchant hints      |
| `message: api-direct-scrape.final`                  | debug | Balance-resolution output is assembled                  |

Authentication/OTP-specific diagnostics depend on the bank's declarative
HTTP flow. There are no INIT, LOGIN, DOM completion, dashboard or
browser-cleanup event contracts. Consult
[API-DIRECT-CALL](../phases/api-direct-call.md) for authentication and
[API-DIRECT-SCRAPE](../phases/api-direct-scrape.md) for data/result guards.

The [forensic audit](forensic-audit.md) runs before the result guard.
Its account count is diagnostic evidence, not a substitute for checking
the final phase/scraper outcome.

## Reading the log

```sh
# Watch the live log
tail -f pipeline.log | jq .

# Find scrape records
jq -c 'select(.phase == "api-direct-scrape")' pipeline.log

# Find failed phase stages
jq -c 'select(.event == "phase-stage" and .result == "FAIL")' pipeline.log
```

## Per-module loggers

Every Pipeline module obtains a Pino child logger derived from its file
path so each event record carries an accurate `module` field without
hand-maintained string constants:

- `getDebug(import.meta.url)` — the default form, used by every Pipeline
  module. The basename of the URL is kebab-cased into the logger name.
- `getDebugByName(name)` — the explicit-name escape hatch for cases
  where the logger name has to be dynamic at construction time
  (for example keying a logger by `companyId`).

Both helpers route through the same lazy-resolved root logger, so
`PiiRedactor` always intercepts before any transport writes — see
[PII redaction](redaction.md) for the censor pipeline.

## Logger cluster anatomy

The pipeline's logger primitives live in `src/Scrapers/Pipeline/Logging/`
(extracted from the legacy `Types/Debug.ts` blob during Phase 12c; that
file became a re-export shim and has since been deleted). Each file owns
one concern so the moving parts are independently testable:

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
  cached) pino root the first time any child logger is read. The cache is
  keyed on the resolved log destination rather than gated on it, so the
  terminal-only root used before `setActiveBank` lands is itself cached
  and is rebuilt when — and only when — the destination actually changes.
  The companion `getRootLoggerGeneration` counter advances on each
  rebuild so the deferred-resolve proxy drops a memoised child on its
  next access after the root behind it was replaced.
- `Logging/ChildLoggerProxy.ts` — `buildDeferredLogger(name)` returns
  the lazy-resolve `Proxy` that backs both `getDebug` and
  `getDebugByName`. The internal `IProxyHandler` type documents the
  exact `get`-trap shape so the cluster's unit tests can assert
  property-access semantics without re-deriving it from `Proxy<T>`.
