# Structured events

The HTTP-only pipeline emits structured Pino records for
`api-direct-call` and `api-direct-scrape`. Stage records use
`event: "phase-stage"`; other records may use structured fields and a
`message` rather than an `event` discriminator. All records pass through
the central redaction pipeline before write.

## Common fields

| Field    | Type   | Notes                                                                                                    |
| -------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `bank`   | string | Active bank's async-local context (entered by `PipelineExecutor` via `runWithBankContext`)               |
| `phase`  | string | `api-direct-call` or `api-direct-scrape` during phase execution (process-global via `ActiveState`)       |
| `stage`  | string | `PRE`, `ACTION`, `POST` or `FINAL` (process-global via `ActiveState`)                                    |
| `runId`  | string | Per-bank-run stamp (reset when `setActiveBank` switches banks); also names the trace folder when enabled |
| `module` | string | Logger/module identifier; typically derived from the module URL, not the phase name                      |
| `event`  | string | Present on discriminated events, including `phase-stage`                                                 |

> **Concurrency note:** `bank` is scoped to each `executePipeline` call via `AsyncLocalStorage`, and `setActiveBank` clears `TraceConfig`'s cached run folder, network directories, and `runId` (minted uniquely via `TraceStamp`'s `nextRunStamp`, reset in tests via `resetRunStampState`) whenever the active bank slug changes so sequential runs in one process stay isolated. `ActiveState` (`phase` and `stage`) and `TraceConfig`'s active-bank, `runId`, and forensic artefact directory state remain process-global, so concurrent scrapes in the same process still share `phase`/`stage` labels, `runId`, and trace output paths; migrating them to async-local storage is a separate follow-up.

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
  On each rebuild, any superseded worker transport (`ThreadStream`) and
  owned file lease (`getActiveRootFileLeaseForTest` in tests) are handed to
  `RetireTransport` so alternating-bank runs never accumulate workers or
  open file descriptors, while `getRootLoggerGeneration` advances so
  deferred proxies drop memoised children on their next access.
- `Logging/FileLease.ts` — main-thread file-descriptor lease primitives
  (`IFileLease`, `ILeasedLoggerHooks`, `ILeasedLoggerResult`,
  `DidCloseLease`, `ILeaseFlushWait`, `DidAwaitLeaseFlush`) plus
  `instantiateLeasedFileLogger`, `awaitLeaseFlush`, and
  `closeFileLeaseAsync`, ensuring all serialized bytes
  reach `pipeline.log` on disk before worker termination and that raw
  descriptors are closed deterministically afterward.
- `Logging/RetireWorkerEnd.ts` — the non-blocking end handshake
  (`requestWorkerEnd`, `WorkerEndOutcome`). Once the main-thread buffer is
  empty and the worker has consumed the ring buffer, it stores `-1` in
  `ThreadStream`'s `WRITE_INDEX`, which makes the worker call
  `destination.end()` and flush/close every target — including buffered
  `pino-pretty` output that `flush()` alone does not acknowledge.
- `Logging/RetireWarnings.ts` — out-of-band retirement reporting
  (`IRetirementState`, `emitRetiredDrainWarning`, `handleTerminateRejection`,
  `makeRetiredErrorListener`): genuine drain failures surface through
  `process.emitWarning`, while stale post-close writes and the terminating
  worker's expected exit stay silent.
- `Logging/RetireTransport.ts` — non-blocking worker retirement
  (`IPinoStreamCandidate`, `DidRetireLogger`, `scheduleStreamClose`, and
  `retireSupersededLogger`) that waits for queued records to reach the worker,
  asks it to end every destination via `RetireWorkerEnd`, and settles on the
  stream `'close'` event. `worker.terminate()` remains the bounded watchdog
  fallback when the handshake is unavailable or a destination never closes;
  synchronous `ThreadStream.end()` is never called on the main event loop.
- `Logging/ChildLoggerProxy.ts` — `buildDeferredLogger(name)` returns
  the lazy-resolve `Proxy` that backs both `getDebug` and
  `getDebugByName` (and intercepts `.child(...)` and `.setBindings(...)`
  so retained sub-loggers likewise re-resolve against the current root
  generation). The internal `IProxyHandler` type documents the exact
  `get`/`set`-trap shape so the cluster's unit tests can assert
  property-access semantics without re-deriving it from `Proxy<T>`.
- `Logging/ChildLoggerState.ts` — `IDeferredChildSpec`,
  `IDeferredChildEntry`, and `BindingsFormatter` state carriers plus
  `captureChindings`, `captureBindingsFormatter`, and `instantiateChild`,
  which snapshot Pino's serialized chindings string, neutralize and restore
  effective `formatters.bindings` without mutating parent tables, and replay
  `level` overrides across root rebuilds.
