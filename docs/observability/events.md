# Structured events

The HTTP-only pipeline emits structured Pino records for
`api-direct-call` and `api-direct-scrape`. Stage records use
`event: "phase-stage"`; other records may use structured fields and a
`message` rather than an `event` discriminator. All records pass through
the central redaction pipeline before write.

## Common fields

| Field    | Type   | Notes                                                                                                    |
| -------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `bank`   | string | The execution's own bank (its run scope, opened by `PipelineExecutor` via `runWithBankContext`)          |
| `phase`  | string | `api-direct-call` or `api-direct-scrape` during phase execution (the execution's own, via `ActiveState`) |
| `stage`  | string | `PRE`, `ACTION`, `POST` or `FINAL` (the execution's own, via `ActiveState`)                              |
| `runId`  | string | One stamp per execution; also names the trace folder when enabled                                        |
| `module` | string | Logger/module identifier; typically derived from the module URL, not the phase name                      |
| `event`  | string | Present on discriminated events, including `phase-stage`                                                 |

### Run identity

Run identity is **per execution**: every `executePipeline` call opens its own run scope (`Types/RunScope.ts`, an `AsyncLocalStorage`) that owns its `bank`, `phase`, `stage`, `runId` and the artefact folders named after the `runId`. Nothing about a run is shared with another run.

| Situation                           | What each execution sees                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Sequential runs, any banks          | Its own `runId`, folder and `pipeline.log`; a repeated same-bank run now gets a new one (see Compatibility) |
| Overlapping runs of different banks | Its own `bank`, `phase`, `stage`, `runId` and `pipeline.log`; the other run's labels never leak in          |
| Overlapping runs of the same bank   | The same, because identity no longer depends on the bank; each has its own `runId` and folder               |
| `FORENSIC_TRACE` off                | No artefact is created, whatever the overlap                                                                |
| A run that has finished             | Its trace is closed, so a late callback cannot reopen its folder or its log file                            |
| Code outside every execution        | Falls back to process-global state: log lines before a run starts, or a test driving a phase directly       |

`Types/RunScope.ts` holds the scope: `openRunScope(bank, fn)` runs `fn` inside a fresh `IRunScope`, `currentRunScope()` reads the running one (or reports that none is), and each scope owns an `IRunTrace` (built by `makeRunTrace`) with its `runId`, run folder, network directory, sub-step folders and the log file its logger was bound to (`noteRunLogFile` records the first one, so a later change to capture cannot make the run forget it). `Types/BankSlugs.ts` is the pure, stateless half of the old trace module: `KNOWN_BANK_SLUGS`, `detectBankFromArgv`, `isKnownBankSlug` (the executor's check that a run has a known bank, which registers nothing) and the `BankSlugLower` and `IsKnownBank` types. `closeActiveRunTrace` in `Types/TraceConfig.ts` marks the running execution's trace finished.

**Construction and cleanup.** The scope opens before the first phase and the `runId` is minted on first use inside it. When the run ends, `PipelineExecutor` disposes the mediator, then retires only the log destination that run owned. The terminal-only destination (no trace file) is shared and is never retired by a run.

**Compatibility.** Two things differ from the previous same-bank behavior. A repeated run of the same bank in one process now gets a new `runId` and folder, where it used to reuse the previous run's. And `executePipeline` no longer calls `setActiveBank`, so it no longer sets the process-global bank; code that read the global bank after a run (rather than during it) now sees the fallback. Sequential isolation, the off-forensic behavior and every public message are unchanged.

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

## Run-stamp allocation baseline

Measurement of `TraceStamp.nextRunStamp` (`src/Tests/Unit/Pipeline/Types/TraceStampStress.test.ts`; greppable line `TRACE_STAMP_BASELINE {json}`).

- **Conditions:** public API only, injected `nowMs`, no disk, no sleeps. 10,000 and 100,000 stamps across five clock shapes: same instant, advancing 25 ms, 1 h rollback, DST fold sweep and DST fold chain. `TZ=Asia/Jerusalem` (fold 2026-10-25 01:00–02:00); 1,000-stamp warm-up; `global.gc()` around heap reads; p50/p99 over 100-call batch means. Host: i7-7660U (4 threads), Node 26.12.0, darwin x64.
- **Baseline (quiet host):** p50 ≈ 3.3 µs per call (5.4–6.4 µs in the fold sweep, which formats twice); 100k stamps ≈ 0.37–0.51 s; p99 8–65 µs. Retained `ISSUED_STAMPS` ≈ 66–73 B per stamp (0.63 MB at 10k, 6.3 MB at 100k), linear. p50 is flat from 10k to 100k.
- **Invariants:** every stamp matches `DD-MM-YYYY_HHMMSScc`, all are unique, and each equals an independent slot oracle in every scenario. Same-instant and rollback never collide, because the start is clamped to `lastStampSlotMs + 10`.
- **Budgets (at least 5x the worst measurement, including a host at load average ~180):** wall 5 s at 10k and 40 s at 100k; p50 50 µs; p99 25 ms; heap 512 B per stamp; p50 growth 10k to 100k at most 6x; heap growth at most 60x.
- **Finding:** `claimUniqueStamp` is non-tail recursive, and its depth equals the run of already-issued stamps it must skip. Only a DST fold can create such a run. `RangeError` was measured at a run of about 7.0k–7.2k stamps under Jest (about 12.7k in plain Node). A failed instant keeps failing until the clock passes the run; a later instant recovers with the exact expected stamp. Work is O(run) per call and amortised O(N), with no quadratic growth.
- **Conclusion:** no performance optimization is justified: microsecond scale, linear time and memory, about 70 B per stamp, and one stamp per execution. The recursion limit needs about 7k stamps issued in one process during the repeated hour, so converting it to a loop would be hardening, not optimization, and is left to a separate decision.

## Cleanup diagnostics

When disposing an execution's mediator fails, the executor emits one `warn` record through that execution's logger and carries on; the scrape's own outcome is never changed and the failure never escapes.

| Field       | Type   | Notes                                                                           |
| ----------- | ------ | ------------------------------------------------------------------------------- |
| `event`     | string | Always `cleanup-failed`                                                         |
| `resource`  | string | Always `api-mediator`                                                           |
| `errorName` | string | A platform or library error class, else `Error`; a thrown name is never trusted |
| `causeCode` | string | The cause's machine-readable code (for example `ECONNRESET`), or empty          |

The thrown value, its message, headers and bodies are never logged, since any of them can quote a credential or a bank answer. Attribution (`bank`, `runId`, `phase`, `stage`) comes from the execution's own scope. A logger that throws while emitting is swallowed, so it cannot become a second failure. Known limit: a mediator installed by the **last** phase of a pipeline is not disposed, because the executor remembers the context a phase starts from; the login phase always precedes the scrape phase in production, and `PipelineExecutorCleanupDiagnostic.test.ts` pins this behavior.

## Worker-retirement fallback limits

If the installed thread-stream's private `kImpl` state is missing or has a different shape, retirement never writes the end marker. It waits for the worker's `flush()` acknowledgement, then for the owned file lease, then calls `worker.terminate()`.

- **Provable:** `pino/file` destinations on an owned lease. The bytes are counted on the main thread and `fstat` confirms they reached disk. If they never arrive, the watchdog terminates the worker and warns `worker drain timed out`.
- **Not provable:** `pino-pretty`, multistream targets and any lease-less destination. The flush acknowledgement only means the worker copied the bytes, so terminating can drop output still buffered inside them.
- **Not detected at runtime:** a layout with the same shape but moved offsets. The pinned dependency graph, `RetireTransportCompat.test.ts` and the packed-consumer layout probe in `consumer-install.sh` guard that instead.

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
- `Logging/BankContext.ts` — `runWithBankContext(bank, fn)` opens the
  execution's run scope; `getBankMixin` is the pino `mixin` callback that
  merges that scope's bank / phase / stage / runId onto every
  log line; `getActiveLogContext` is a read-only accessor over the same
  record so tests can assert the mixin contract directly without
  depending on transport-flush timing.
- `Logging/RootLogger.ts` — `getRootLogger` returns the pino root for the
  caller's resolved log destination, building it the first time any child
  logger is read. `retireRunLogger` ends a run's logging and retires only the
  destination that run recorded; it does not re-resolve a path, so it neither touches
  the file system nor depends on capture still being on. `getRootLoggerGeneration` changes exactly when that
  destination's logger is rebuilt, so deferred proxies drop memoised children
  on their next access.
- `Logging/LoggerSlots.ts` — the registry behind it: one slot per log file,
  so overlapping executions each own a logger bound to their own
  `pipeline.log`. A slot is retired by its owning run, never because another
  run asked for a different destination. Outside every execution the ambient
  destination keeps the old behavior: moving to a new run folder retires the
  previous ambient one, handing its worker transport (`ThreadStream`) and file
  lease (`getActiveRootFileLeaseForTest` in tests) to `RetireTransport` so
  alternating-bank runs never accumulate workers or open file descriptors.
- `Logging/LoggerSlots.ts` also exports the pieces `RootLogger` builds on:
  `slotFor` (the `ILoggerSlot` serving a destination, built on first use from an
  `ISlotRequest` and its `SlotBuilder`), `generationFor`, `leaseFor` and
  `retireRunSlot`.
- `Core/Executor/CleanupDiagnostic.ts` — the failed-disposal warning:
  `buildCleanupWarning` builds the allowlisted `ICleanupWarning` fields and
  `reportCleanupFailure` emits them through the execution's logger without ever
  throwing.
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
