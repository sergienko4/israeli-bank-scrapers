---
title: INIT navigation forensics
source-files:
  - src/Scrapers/Pipeline/Mediator/Init/NavigationDiagnostics.ts
  - src/Scrapers/Pipeline/Mediator/Init/NavigationRequestLifecycle.ts
  - src/Scrapers/Pipeline/Mediator/Init/NavigationTransportProbe.ts
  - src/Scrapers/Pipeline/Mediator/Init/InitActions.ts
status: new
---

# INIT navigation forensics

When the INIT phase's `executeNavigateToBank` cannot reach the bank URL, the
failing call now emits a structured warn log _in addition_ to the
`ScraperErrorTypes.Generic` it has always returned. The extra log line
captures transport-layer evidence (wall-clock attempt timing, final page URL,
classified error category, failed sub-requests, in-flight sub-requests, and
optionally a Node-level DNS / TCP / TLS probe) so CI-only nav timeouts can
be triaged from logs alone — no rerun required.

The motivating example is the Beinleumi nav timeout that flaked exclusively on
GitHub Actions Azure runners while local + production traffic succeeded
against the same target. The pre-forensics log only carried the Playwright
error string (`page.goto: Timeout 15000ms exceeded`), so we could not
distinguish DNS regression from TLS reject from healthy-but-slow first byte.

The forensics layer is split across three small files in
`src/Scrapers/Pipeline/Mediator/Init/`:

- `NavigationDiagnostics.ts` — snapshot composition + logger emission.
- `NavigationRequestLifecycle.ts` — Playwright `Page` request lifecycle
  observer (records every request that started but never finished).
- `NavigationTransportProbe.ts` — Node-level `dns.lookup` / `net.connect` /
  `tls.connect` probe, runnable post-failure with a hard budget.

All three are wired into `InitActions.ts` via ≤10-LoC private helpers
(`runNavigationAttempt`, `collectFailureContext`, `handleNavFailure`,
`maybeRunTransportProbe`). Public exports unchanged — every new symbol is
internal to the `Mediator/Init` cluster.

## Log envelope

The warn log carries an `INavFailureSnapshot`. Fields are stable across
versions; new fields are added at the bottom of the table.

| Field | Type | Notes |
|---|---|---|
| `event` | string | Always `INIT-ACTION-NAV-FAILURE` — grep target for CI log scrapers |
| `attemptDurationMs` | number | Wall-clock ms between `page.goto` start and the throw (`Date.now()` diff) |
| `finalUrl` | string | `page.url()` at the moment of failure (often `about:blank` for early timeouts) |
| `errorName` | string | The Playwright error's `name` (e.g. `TimeoutError`) |
| `errorMessage` | string | The original Playwright error message, verbatim |
| `category` | `NavErrorCategory` | One of `timeout / dns / tcp-refused / tcp-reset / tls / unknown` |
| `failedRequests` | `INavFailedRequest[]` | Sub-requests captured via `page.on('requestfailed')` during the attempt |
| `inFlightRequests` | `INavInFlightRequest[]` | Requests that **started but never finished** at the moment of failure (capped at 25, oldest-first) |
| `inFlightRequestCount` | number | True count of in-flight requests at failure time — may exceed `inFlightRequests.length` when the cap kicked in |
| `inFlightRequestsTruncated` | boolean | `true` iff `inFlightRequestCount > 25`; signals the array was sliced |
| `nodeTransportProbe` | `Option<INavTransportProbe>` | `Some(probe)` only when the ambiguous fingerprint triggered the probe (see below); `None` otherwise |

`INavFailedRequest` carries `url` and `errorText` only. The literal string
`unknown` is used when Playwright reports no failure text — covered by a
regression spec in `NavigationDiagnostics.test.ts`.

`INavInFlightRequest` carries `url`, `method`, `resourceType`, `state`
(`started` or `response-received`), and `startedMsAgo` (computed against the
snapshot's now). Use the `state` field to distinguish "TCP/TLS never
completed" (`started`) from "server returned headers but body hung"
(`response-received`).

`INavTransportProbe` is described in detail in the [Node-level transport
probe](#node-level-transport-probe) section.

Sample output (Beinleumi nav timeout with all three sources populated):

```jsonc
{
  "event": "INIT-ACTION-NAV-FAILURE",
  "attemptDurationMs": 15003,
  "finalUrl": "about:blank",
  "errorName": "TimeoutError",
  "errorMessage": "page.goto: Timeout 15000ms exceeded.",
  "category": "timeout",
  "failedRequests": [],
  "inFlightRequests": [
    {
      "url": "https://www.fibi.co.il/private/",
      "method": "GET",
      "resourceType": "document",
      "state": "started",
      "startedMsAgo": 14998
    }
  ],
  "inFlightRequestCount": 1,
  "inFlightRequestsTruncated": false,
  "nodeTransportProbe": {
    "_tag": "Some",
    "value": {
      "host": "www.fibi.co.il",
      "port": 443,
      "outcome": "tls-timeout",
      "dnsLookupMs": 42,
      "tcpConnectMs": 31,
      "tlsHandshakeMs": 0,
      "resolvedAddress": "167.86.44.213",
      "errorText": "TLS_HANDSHAKE_TIMEOUT",
      "timing": "post-failure",
      "startedMsAfterGotoFailure": 8,
      "totalBudgetMs": 5000
    }
  }
}
```

## Error categories

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

## Request lifecycle observer

`attachRequestLifecycleObserver(page)` subscribes to the four Playwright
`Page` events that bracket a request's lifetime
(`request`, `response`, `requestfinished`, `requestfailed`). It returns
`{ snapshot, detach }`:

- `snapshot()` is a pure read — never throws, never awaits. It returns
  `INavInFlightSnapshot { inFlightRequests, inFlightRequestCount,
  inFlightRequestsTruncated }`. Always sorted oldest-first; capped at 25
  entries with the `isTruncated` flag set when the true count exceeded the
  cap.
- `detach()` removes the four listeners. **Must be called in a `finally`
  block** so a forgotten observer does not leak listeners onto a reused page.

The cap of 25 is deliberately small — at the moment of a nav timeout we want
the oldest stuck requests, not a verbatim transcript of every script tag.

`InitActions.runNavigationAttempt` attaches the observer alongside the
existing `attachFailedRequestCollector` and snapshots it **synchronously in
the catch block** via `collectFailureContext` — before any `await` runs and
mutates the in-flight set.

## Node-level transport probe

The probe runs **only** when the failure fingerprint is ambiguous:

- `category === 'timeout'` AND
- `failedRequests.length === 0` AND
- `finalUrl === 'about:blank'`

This is exactly the Beinleumi profile: Playwright timed out, the browser
never produced a `requestfailed` event, and the page never committed off
`about:blank`. The probe gives an independent Node-side view of DNS / TCP /
TLS so we can tell whether the browser was lying about network reachability.

The probe is **post-failure** — it runs after `page.goto` has thrown and
takes Camoufox out of the picture. The field is therefore named
`nodeTransportProbe` (not `transportProbe`) so log readers understand the
caveat. The hard budget is 5 s total (split: 1.5 s DNS, 2 s TCP, 1.5 s TLS).
The probe **always resolves** (never throws) and always returns a result with
one of these outcomes:

| Outcome | Meaning |
|---|---|
| `connected` | All three phases succeeded — Node can reach the target. Browser-side issue. |
| `dns-error` | `dns.lookup` failed. DNS regression — check resolver / `/etc/resolv.conf`. |
| `tcp-timeout` | TCP SYN sent, no response within budget. Likely upstream firewall / IP-tier block. |
| `tcp-refused` | RST received on SYN. Service down or wrong port. |
| `tcp-reset` | Connection reset mid-flight. Likely TCP-layer block. |
| `tls-timeout` | TCP completed, TLS handshake never returned. Likely WAF dropping ClientHello. |
| `tls-handshake-error` | TLS handshake returned a hard error (cert / protocol mismatch). |
| `other-error` | Caller's `dns` / `net` / `tls` deps threw something unexpected; full message in `errorText`. |

Every outcome carries the three timing fields (`dnsLookupMs`, `tcpConnectMs`,
`tlsHandshakeMs`) with `0` for any phase that did not run. `resolvedAddress`
holds the IP `dns.lookup` returned (empty string when DNS failed).

The probe exposes a DI seam for tests:

- `probeTransport(input)` — production entry point; uses Node's built-in
  `dns` / `net` / `tls` modules.
- `probeTransportWithDeps({ run, deps })` — same logic with injectable
  `ITransportProbeDeps { dnsLookup, tcpConnect, tlsUpgrade }`. Every
  outcome path is reachable with plain object stubs — no `jest.mock`.

## Operator triage table

Use this to decide what to investigate first when a log line lands:

| Snapshot fingerprint | Likely cause | Next action |
|---|---|---|
| `category=timeout`, `failedRequests=[]`, `inFlightRequests=[]`, no probe | Pre-network failure (browser frozen?) | Check Camoufox / launcher logs |
| `category=timeout`, `inFlightRequests=[{ state: 'started' }]`, probe `connected` | Browser fingerprint blocked but Node reachable | Look at WAF / bot-detection on bank side |
| `category=timeout`, probe `dns-error` | DNS resolver regression in CI | Inspect `dns-warmup.sh` / resolver config |
| `category=timeout`, probe `tcp-timeout` | IP-tier firewall / outbound block | Check runner egress allow-list |
| `category=timeout`, probe `tls-timeout` | WAF dropping ClientHello (silent block) | Check Radware / Cloudflare config for the target |
| `category=tls`, any probe | Cert / protocol mismatch | Verify bank cert vs runner trust store |
| `category=dns`, any | Resolver issue | Re-run probe locally to confirm |

## Public surface

| Symbol | Module | Role |
|---|---|---|
| `classifyNavError` | `NavigationDiagnostics` | Maps a Playwright error message to a `NavErrorCategory` |
| `attachFailedRequestCollector` | `NavigationDiagnostics` | Subscribes to `page.on('requestfailed')`; returns `{ collected, detach }` |
| `buildNavFailureSnapshot` | `NavigationDiagnostics` | Composes an `INavFailureSnapshot` from the input bundle |
| `wrapProbeAsOption` | `NavigationDiagnostics` | Wraps a probe result as `Some` for the snapshot field |
| `logNavFailureSnapshot` | `NavigationDiagnostics` | Emits the warn log line and returns the snapshot for echo/test inspection |
| `attachRequestLifecycleObserver` | `NavigationRequestLifecycle` | Subscribes to the four request/response lifecycle events; returns `{ snapshot, detach }` |
| `probeTransport` | `NavigationTransportProbe` | Production entry point — always resolves, runs DNS → TCP → TLS within budget |
| `probeTransportWithDeps` | `NavigationTransportProbe` | DI seam — same logic with injectable `ITransportProbeDeps` |
| `IFailedRequestCollector` | `NavigationDiagnostics` | Lifecycle handle returned by `attachFailedRequestCollector` (field: `collected`) |
| `INavFailedRequest` | `NavigationDiagnostics` | Shape of one entry in `failedRequests` |
| `INavFailureInput` | `NavigationDiagnostics` | Options-object input to `buildNavFailureSnapshot` (respects `max-params: 3`) |
| `INavFailureSnapshot` | `NavigationDiagnostics` | The full warn envelope written to the logger |
| `NavErrorCategory` | `NavigationDiagnostics` | Union of the six category literals |
| `INavInFlightRequest` | `NavigationRequestLifecycle` | Shape of one entry in `inFlightRequests` |
| `INavInFlightSnapshot` | `NavigationRequestLifecycle` | Result of `IRequestLifecycleObserver.snapshot()` |
| `IRequestLifecycleObserver` | `NavigationRequestLifecycle` | Lifecycle handle returned by `attachRequestLifecycleObserver` |
| `RequestLifecycleState` | `NavigationRequestLifecycle` | Union of `'started' \| 'response-received'` |
| `INavTransportProbe` | `NavigationTransportProbe` | Shape of the probe envelope written to the snapshot |
| `IProbeRunInput` | `NavigationTransportProbe` | Per-run inputs (`targetUrl`, `totalBudgetMs`, `startedMsAfterGotoFailure`) |
| `IProbeTransportInput` | `NavigationTransportProbe` | DI bundle for `probeTransportWithDeps` |
| `ITransportProbeDeps` | `NavigationTransportProbe` | Injectable `dns` / `net` / `tls` triad |
| `IDnsLookupResult` | `NavigationTransportProbe` | Resolved address + `family` returned by the injectable `dnsLookup` dep |
| `ITcpHandshakeResult` | `NavigationTransportProbe` | Socket handle returned by the injectable `tcpConnect` dep |
| `TransportProbeOutcome` | `NavigationTransportProbe` | Union of the eight outcome literals |

## Lifecycle invariants

- The `requestfailed` collector AND the lifecycle observer are attached
  _before_ `page.goto` and detached in the `finally` block — no listener
  leak onto the page even on success.
- The failure context is snapshotted **synchronously in the catch block**
  via `collectFailureContext` BEFORE any `await` runs. This means the
  in-flight set and final URL reflect the moment of failure — not the
  network state ~5 s later after the probe ran.
- The transport probe **always resolves** (never throws) and respects a hard
  total budget (`NODE_TRANSPORT_PROBE_BUDGET_MS = 5000`). All sockets and
  timers are released in every code path.
- The forensics log fires **only** on failure. The success path is
  byte-identical to the pre-forensics behaviour; no extra logger.warn /
  debug calls.
- The error type returned to callers is unchanged: still
  `ScraperErrorTypes.Generic` with the same message format. Callers do not
  need to branch on the new telemetry.

## See also

- [Structured events](events.md) — the broader event taxonomy
- [Forensic audit](forensic-audit.md) — the post-mortem story this slots into
- `src/Scrapers/Pipeline/Mediator/Init/NavigationDiagnostics.ts` — snapshot composition
- `src/Scrapers/Pipeline/Mediator/Init/NavigationRequestLifecycle.ts` — lifecycle observer
- `src/Scrapers/Pipeline/Mediator/Init/NavigationTransportProbe.ts` — Node-level probe
- `src/Tests/Unit/Pipeline/Mediator/Init/NavigationDiagnostics.test.ts` — snapshot specs
- `src/Tests/Unit/Pipeline/Mediator/Init/NavigationRequestLifecycle.test.ts` — observer specs
- `src/Tests/Unit/Pipeline/Mediator/Init/NavigationTransportProbe.test.ts` — probe specs
