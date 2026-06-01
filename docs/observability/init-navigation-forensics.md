---
title: INIT navigation forensics
source-files:
  - src/Scrapers/Pipeline/Mediator/Init/NavigationDiagnostics.ts
  - src/Scrapers/Pipeline/Mediator/Init/InitActions.ts
status: new
---

# INIT navigation forensics

When the INIT phase's `executeNavigateToBank` cannot reach the bank URL, the
failing call now emits a structured warn log _in addition_ to the
`ScraperErrorTypes.Generic` it has always returned. The extra log line
captures transport-layer evidence (wall-clock attempt timing, final page URL,
classified error category, failed sub-requests) so CI-only nav timeouts can
be triaged from logs alone — no rerun required.

The motivating example is the Beinleumi nav timeout that flaked exclusively on
GitHub Actions Azure runners while local + production traffic succeeded
against the same target. The pre-forensics log only carried the Playwright
error string (`page.goto: Timeout 15000ms exceeded`), so we could not
distinguish DNS regression from TLS reject from healthy-but-slow first byte.

The forensics helper lives in
`src/Scrapers/Pipeline/Mediator/Init/NavigationDiagnostics.ts` and is wired
into `InitActions.ts` via two ≤10-LoC private helpers (`runNavigationAttempt`,
`handleNavFailure`). Public exports unchanged — the new module is internal to
the `Mediator/Init` cluster.

## Log envelope

| Field | Type | Notes |
|---|---|---|
| `event` | string | Always `INIT-ACTION-NAV-FAILURE` — grep target for CI log scrapers |
| `bankUrl` | string | URL passed to `page.goto` |
| `currentUrl` | string | `page.url()` at the moment of failure (often `about:blank` for early timeouts) |
| `attemptedNavMs` | number | Wall-clock ms between `page.goto` start and the throw (`Date.now()` diff) |
| `errorMessage` | string | The original Playwright error message, verbatim |
| `errorCategory` | `NavErrorCategory` | One of `timeout / dns / tcp-refused / tcp-reset / tls / unknown` |
| `failedRequests` | `INavFailedRequest[]` | Sub-requests captured via `page.on('requestfailed')` during the attempt |

`INavFailedRequest` carries `url`, `method`, `resourceType`, and `errorText`
(falling back to the literal string `unknown` when Playwright reports no
failure text — covered by the regression test in
`NavigationDiagnostics.test.ts`).

Sample output:

```jsonc
{
  "event": "INIT-ACTION-NAV-FAILURE",
  "bankUrl": "https://www.fibi.co.il/private/",
  "currentUrl": "about:blank",
  "attemptedNavMs": 15003,
  "errorMessage": "page.goto: Timeout 15000ms exceeded.",
  "errorCategory": "timeout",
  "failedRequests": [
    {
      "url": "https://www.fibi.co.il/private/",
      "method": "GET",
      "resourceType": "document",
      "errorText": "net::ERR_TIMED_OUT"
    }
  ]
}
```

## Categories

`classifyNavError(message)` runs the Playwright error string against a static
`CATEGORY_PATTERNS` array. The first matching pattern wins; the catch-all
`unknown` fires when no pattern matches. Adding a new category is a one-line
push to the array — no `if` / `else` ladder, no caller changes.

| Category | Matches messages containing |
|---|---|
| `timeout` | `Timeout`, `Navigation timeout` (Playwright's default 15 / 30 s gate) |
| `dns` | `ERR_NAME_NOT_RESOLVED`, `getaddrinfo`, `EAI_AGAIN` |
| `tcp-refused` | `ECONNREFUSED`, `ERR_CONNECTION_REFUSED` |
| `tcp-reset` | `ECONNRESET`, `ERR_CONNECTION_RESET` |
| `tls` | `ERR_SSL_PROTOCOL_ERROR`, `ERR_CERT_*`, `SSL handshake failed` |
| `unknown` | Everything else (DEFAULT — keeps the log line uniform when a new failure mode appears) |

## Public surface

The helper module exposes a small, intentional API. None of these symbols are
re-exported through `src/index.ts` — they are internal to the `Mediator/Init`
cluster.

| Symbol | Kind | Role |
|---|---|---|
| `classifyNavError` | function | Maps a Playwright error message to a `NavErrorCategory` |
| `attachFailedRequestCollector` | function | Subscribes to `page.on('requestfailed')`; returns `{ getRequests, detach }` |
| `buildNavFailureSnapshot` | function | Composes an `INavFailureSnapshot` from the input bundle |
| `logNavFailureSnapshot` | function | Emits the warn log line and returns the snapshot for echo/test inspection |
| `IFailedRequestCollector` | interface | Lifecycle handle returned by `attachFailedRequestCollector` |
| `INavFailedRequest` | interface | Shape of one entry in `failedRequests` |
| `INavFailureInput` | interface | Options-object input to `buildNavFailureSnapshot` (respects `max-params: 3`) |
| `INavFailureSnapshot` | interface | The full warn envelope written to the logger |
| `NavErrorCategory` | type | Union of the six category literals above |

## Lifecycle invariants

- The `requestfailed` listener is attached _before_ `page.goto` and detached
  in the `finally` block — no listener leak onto the page even on success.
- The forensics log fires **only** on failure. The success path is byte-identical
  to the pre-forensics behaviour; no extra logger.warn / debug calls.
- The error type returned to callers is unchanged: still
  `ScraperErrorTypes.Generic` with the same message format. Callers do not
  need to branch on the new telemetry.
- Coverage: `NavigationDiagnostics.ts` is at 100% branches (4/4) — the
  unknown-errorText fallback is covered by a dedicated regression spec in
  `NavigationDiagnostics.test.ts`.

## See also

- [Structured events](events.md) — the broader event taxonomy
- [Forensic audit](forensic-audit.md) — the post-mortem story this slots into
- `src/Scrapers/Pipeline/Mediator/Init/NavigationDiagnostics.ts` — implementation
- `src/Tests/Unit/Pipeline/Mediator/Init/NavigationDiagnostics.test.ts` — regression specs (16)
