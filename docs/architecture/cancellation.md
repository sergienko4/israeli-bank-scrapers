# Cancellation and run deadlines

A scrape can be cancelled by the caller and bounded by a deadline. Both are
additive public options on `ScraperOptions`; neither changes the result shape.

| Option              | Meaning                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `signal`            | An `AbortSignal`. Once it fires, no further phase starts and in-flight requests are aborted.  |
| `deadlineMs`        | Whole-run deadline in milliseconds from execution start. A positive finite value only.        |
| `callbackTimeoutMs` | Maximum wait for `onAuthFlowComplete` and `onPersistentAuthStateUpdate` (default 30 seconds). |
| `otpTimeoutMs`      | Existing OTP prompt budget; unchanged and separate from the fields above.                     |

## One signal per run

`PipelineExecutor.runAbortSignal` combines the caller's `signal` with
`AbortSignal.timeout(deadlineMs)` through `AbortSignal.any`. The result lives in
the run scope, and `currentAbortSignal()` exposes it to the phases and both
transports without threading it through every call. `isRunAborted()` is the
shared boolean check used by the reducer, transports and recovery gate.

Before each phase, `PipelineReducer` asks `currentAbortSignal()`. An aborted
run returns a `TIMEOUT` failure with the fixed message `scrape aborted`; the
phase that was running is never re-run, which matters because the auth phase can
send an SMS OTP. `failedPhase` applies the same precedence when a phase fails or
throws after cancellation, so the abort verdict is never replaced by the
phase's own error.

## Both transports

The capped native transport (`CappedBody.requestSignal`) and the node:https
mTLS transport (`MtlsRequest.requestSignal`) combine their own per-request
timeout with the run signal. An abort therefore reaches `globalThis.fetch` and
`https.request` the same way.

`TransportFailure` classifies the abort as `TIMEOUT`. It is not a socket code,
so `ConnectRetry` never retries it, and it is not auth-shaped, so
`shouldRecoverSession` never starts a cold login or a second OTP after an abort.
The request-local controller still aborts the response body, and node closes the
mTLS socket, so settlement leaves no open body or socket.

## Caller callbacks

`withCallbackDeadline` races each callback against an `AbortSignal.timeout`
deadline. A rejection from that deadline is a dedicated `CallbackTimeoutError`,
so `raceTimeout` converts only that class to its sentinel and leaves unrelated
rejections untouched. The timer is unref'd by Node, so it never keeps the process alive, and
the deadline listener fires once. A callback that outlives its budget behaves
like a throw:

- `onAuthFlowComplete` is logged by error name and the scrape stays successful.
- `onPersistentAuthStateUpdate` fails authentication before the new bearer is
  used.

A timed-out callback is not cancelled: it may still complete after the scrape
moves on. Implementations must therefore make storage writes idempotent and
ignore a write that is older than the newest token they have already stored;
otherwise a slow first write could overwrite a recovery token and force another
login. The timer itself is owned and cleared when the race settles, and the run
abort listener is removed at the same time.

The OTP retriever keeps its own `otpTimeoutMs` budget; wrapping it again here
would change the documented prompt window.
