---
title: INIT navigation forensics
source-files:
  - src/Scrapers/Pipeline/Mediator/Init/NavigationDiagnostics.ts
  - src/Scrapers/Pipeline/Mediator/Init/NavigationRequestLifecycle.ts
  - src/Scrapers/Pipeline/Mediator/Init/NavigationTransportProbe.ts
  - src/Scrapers/Pipeline/Mediator/Init/InitActions.ts
  - src/Scrapers/Pipeline/Mediator/Init/InitForensicsGate.ts
  - src/Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/AuthReqTrace.ts
  - src/Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/AuthReqTraceGate.ts
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
  `tls.connect` probe, runnable post-failure with a hard budget. As of the
  Phase 12e split this file is a thin **barrel facade**: the former 1036-LoC
  monolith was decomposed (behavior-preserving) into a focused
  `TransportProbe/` sub-cluster — one module per concern (`Types`, `Reject`,
  `Result`, `Url`, `Dns`, `Tcp`, `Tls`, `Probe`). The public surface
  (`probeTransport`, `probeTransportWithDeps`, and the `I*` envelope types)
  is re-exported byte-for-byte through the facade, so consumers and the log
  envelope are unchanged.

All three are wired into `InitActions.ts` via ≤10-LoC private helpers
(`runNavigationAttempt`, `collectFailureContext`, `handleNavFailure`,
`maybeRunTransportProbe`). Public exports unchanged — every new symbol is
internal to the `Mediator/Init` cluster.

Sibling helpers in `InitActions.ts` (`applyPostLaunchSetup`,
`coldStartIfDumping`) handle pre-navigation context setup; Phase 7.5
removed the obsolete `MOCK_MODE` route-install branch from
`applyPostLaunchSetup` (the mock-replay pipeline was orphaned), so the
post-launch path now runs only the DUMP_SNAPSHOTS cold-start scrub
and `setupPage`. None of the navigation forensics surface changed.

## Log envelope

The warn log carries an `INavFailureSnapshot`. Fields are stable across
versions; new fields are added at the bottom of the table.

| Field                       | Type                         | Notes                                                                                                                                                                                       |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event`                     | string                       | Always `INIT-ACTION-NAV-FAILURE` — grep target for CI log scrapers                                                                                                                          |
| `attemptDurationMs`         | number                       | Wall-clock ms between `page.goto` start and the throw (`Date.now()` diff)                                                                                                                   |
| `finalUrl`                  | string                       | `page.url()` at the moment of failure (often `about:blank` for early timeouts)                                                                                                              |
| `errorName`                 | string                       | The Playwright error's `name` (e.g. `TimeoutError`)                                                                                                                                         |
| `errorMessage`              | string                       | The original Playwright error message, verbatim                                                                                                                                             |
| `category`                  | `NavErrorCategory`           | One of `timeout / dns / tcp-refused / tcp-reset / tls / unknown`                                                                                                                            |
| `failedRequests`            | `INavFailedRequest[]`        | Sub-requests captured via `page.on('requestfailed')` during the attempt                                                                                                                     |
| `inFlightRequests`          | `INavInFlightRequest[]`      | Requests that **started but never finished** at the moment of failure (capped at 25, oldest-first)                                                                                          |
| `inFlightRequestCount`      | number                       | True count of in-flight requests at failure time — may exceed `inFlightRequests.length` when the cap kicked in                                                                              |
| `inFlightRequestsTruncated` | boolean                      | `true` iff `inFlightRequestCount > 25`; signals the array was sliced                                                                                                                        |
| `nodeTransportProbe`        | `Option<INavTransportProbe>` | `Some(probe)` only when the ambiguous fingerprint triggered the probe (see below); `None` otherwise                                                                                         |
| `frameTree`                 | `IFrameInfo[]`               | Snapshot of `page.frames()` at the moment of failure — name, URL, `isAttached`. Diagnoses "page rendered but blank" (L7) where main frame is `about:blank` but iframes loaded               |
| `consoleErrors`             | `IConsoleErrorEntry[]`       | Buffered `console.error` + `console.warn` + `pageerror` from launch onward (capped at 50). Catches CSP violations, JS exceptions, third-party script breakage that L4 cannot see            |
| `landingResponse`           | `Option<IResponseInfo>`      | Capture of the LOGIN landing HTTP response — status, selected headers (allowlisted), body length, redirect chain length. `set-cookie` values redacted to `[REDACTED]` to keep logs PII-safe |

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
      "startedMsAgo": 14998,
    },
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
      "totalBudgetMs": 5000,
    },
  },
}
```

## Error categories

`classifyNavError(message)` runs the Playwright error string against a static
`CATEGORY_PATTERNS` array. The first matching pattern wins; the catch-all
`unknown` fires when no pattern matches. Adding a new category is a one-line
push to the array — no `if` / `else` ladder, no caller changes.

| Category      | Matches messages containing                                                            |
| ------------- | -------------------------------------------------------------------------------------- |
| `timeout`     | `Timeout`, `Navigation timeout` (Playwright's default 15 / 30 s gate)                  |
| `dns`         | `ERR_NAME_NOT_RESOLVED`, `getaddrinfo`, `EAI_AGAIN`                                    |
| `tcp-refused` | `ECONNREFUSED`, `ERR_CONNECTION_REFUSED`                                               |
| `tcp-reset`   | `ECONNRESET`, `ERR_CONNECTION_RESET`                                                   |
| `tls`         | `ERR_SSL_PROTOCOL_ERROR`, `ERR_CERT_*`, `SSL handshake failed`                         |
| `unknown`     | Everything else (DEFAULT — keeps the log line uniform when a new failure mode appears) |

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

| Outcome               | Meaning                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `connected`           | All three phases succeeded — Node can reach the target. Browser-side issue.                  |
| `dns-error`           | `dns.lookup` failed. DNS regression — check resolver / `/etc/resolv.conf`.                   |
| `tcp-timeout`         | TCP SYN sent, no response within budget. Likely upstream firewall / IP-tier block.           |
| `tcp-refused`         | RST received on SYN. Service down or wrong port.                                             |
| `tcp-reset`           | Connection reset mid-flight. Likely TCP-layer block.                                         |
| `tls-timeout`         | TCP completed, TLS handshake never returned. Likely WAF dropping ClientHello.                |
| `tls-handshake-error` | TLS handshake returned a hard error (cert / protocol mismatch).                              |
| `other-error`         | Caller's `dns` / `net` / `tls` deps threw something unexpected; full message in `errorText`. |

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

| Snapshot fingerprint                                                             | Likely cause                                   | Next action                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `category=timeout`, `failedRequests=[]`, `inFlightRequests=[]`, no probe         | Pre-network failure (browser frozen?)          | Check Camoufox / launcher logs                   |
| `category=timeout`, `inFlightRequests=[{ state: 'started' }]`, probe `connected` | Browser fingerprint blocked but Node reachable | Look at WAF / bot-detection on bank side         |
| `category=timeout`, probe `dns-error`                                            | DNS resolver regression in CI                  | Inspect `dns-warmup.sh` / resolver config        |
| `category=timeout`, probe `tcp-timeout`                                          | IP-tier firewall / outbound block              | Check runner egress allow-list                   |
| `category=timeout`, probe `tls-timeout`                                          | WAF dropping ClientHello (silent block)        | Check Radware / Cloudflare config for the target |
| `category=tls`, any probe                                                        | Cert / protocol mismatch                       | Verify bank cert vs runner trust store           |
| `category=dns`, any                                                              | Resolver issue                                 | Re-run probe locally to confirm                  |

## Public surface

| Symbol                           | Module                       | Role                                                                                                                                                                                      |
| -------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classifyNavError`               | `NavigationDiagnostics`      | Maps a Playwright error message to a `NavErrorCategory`                                                                                                                                   |
| `attachFailedRequestCollector`   | `NavigationDiagnostics`      | Subscribes to `page.on('requestfailed')`; returns `{ collected, detach }`                                                                                                                 |
| `buildNavFailureSnapshot`        | `NavigationDiagnostics`      | Composes an `INavFailureSnapshot` from the input bundle                                                                                                                                   |
| `wrapProbeAsOption`              | `NavigationDiagnostics`      | Wraps a probe result as `Some` for the snapshot field                                                                                                                                     |
| `logNavFailureSnapshot`          | `NavigationDiagnostics`      | Emits the warn log line and returns the snapshot for echo/test inspection                                                                                                                 |
| `attachRequestLifecycleObserver` | `NavigationRequestLifecycle` | Subscribes to the four request/response lifecycle events; returns `{ snapshot, detach }`                                                                                                  |
| `probeTransport`                 | `NavigationTransportProbe`   | Production entry point — always resolves, runs DNS → TCP → TLS within budget                                                                                                              |
| `probeTransportWithDeps`         | `NavigationTransportProbe`   | DI seam — same logic with injectable `ITransportProbeDeps`                                                                                                                                |
| `IFailedRequestCollector`        | `NavigationDiagnostics`      | Lifecycle handle returned by `attachFailedRequestCollector` (field: `collected`)                                                                                                          |
| `INavFailedRequest`              | `NavigationDiagnostics`      | Shape of one entry in `failedRequests`                                                                                                                                                    |
| `INavFailureInput`               | `NavigationDiagnostics`      | Options-object input to `buildNavFailureSnapshot` (respects `max-params: 3`)                                                                                                              |
| `INavFailureSnapshot`            | `NavigationDiagnostics`      | The full warn envelope written to the logger                                                                                                                                              |
| `NavErrorCategory`               | `NavigationDiagnostics`      | Union of the six category literals                                                                                                                                                        |
| `INavInFlightRequest`            | `NavigationRequestLifecycle` | Shape of one entry in `inFlightRequests`                                                                                                                                                  |
| `INavInFlightSnapshot`           | `NavigationRequestLifecycle` | Result of `IRequestLifecycleObserver.snapshot()`                                                                                                                                          |
| `IRequestLifecycleObserver`      | `NavigationRequestLifecycle` | Lifecycle handle returned by `attachRequestLifecycleObserver`                                                                                                                             |
| `RequestLifecycleState`          | `NavigationRequestLifecycle` | Union of `'started' \| 'response-received'`                                                                                                                                               |
| `INavTransportProbe`             | `NavigationTransportProbe`   | Shape of the probe envelope written to the snapshot                                                                                                                                       |
| `IProbeRunInput`                 | `NavigationTransportProbe`   | Per-run inputs (`targetUrl`, `totalBudgetMs`, `startedMsAfterGotoFailure`)                                                                                                                |
| `IProbeTransportInput`           | `NavigationTransportProbe`   | DI bundle for `probeTransportWithDeps`                                                                                                                                                    |
| `ITransportProbeDeps`            | `NavigationTransportProbe`   | Injectable `dns` / `net` / `tls` triad                                                                                                                                                    |
| `IDnsLookupResult`               | `NavigationTransportProbe`   | Resolved address + `family` returned by the injectable `dnsLookup` dep                                                                                                                    |
| `ITcpHandshakeResult`            | `NavigationTransportProbe`   | Socket handle returned by the injectable `tcpConnect` dep                                                                                                                                 |
| `TransportProbeOutcome`          | `NavigationTransportProbe`   | Union of the eight outcome literals                                                                                                                                                       |
| `captureFrameTree`               | `PageObservers`              | Sync snapshot of `page.frames()` → `IFrameInfo[]`. Catch-block safe.                                                                                                                      |
| `attachConsoleErrorBuffer`       | `PageObservers`              | Subscribes to `console.error`/`console.warn`/`pageerror`; returns `IConsoleErrorBuffer` with `{ collected, detach }`. Source kind is one of `ConsoleErrorSource`.                         |
| `attachLandingResponseCollector` | `PageObservers`              | Subscribes to `page.on('response')` for the main-frame landing URL; returns `ILandingResponseCollector` with `{ getResponse, detach }`. Allowlists headers + redacts `set-cookie` values. |
| `IFrameInfo`                     | `PageObservers`              | Shape of one entry in `frameTree` (`name`, `url`, `isAttached`)                                                                                                                           |
| `IConsoleErrorEntry`             | `PageObservers`              | Shape of one entry in `consoleErrors` (`kind`, `text`, `urlLocation`, `lineNumber`, `columnNumber`)                                                                                       |
| `IResponseInfo`                  | `PageObservers`              | Shape of `landingResponse.value` (`url`, `status`, `headers`, `bodyByteLength`, `redirectChainLength`)                                                                                    |
| `logEnvSnapshot`                 | `EnvSnapshot`                | Success-path-only emitter — captures `IEnvSnapshot` and emits the `PIPELINE-ENV` log via `ILogEnvInput`                                                                                   |
| `IEnvSnapshot`                   | `EnvSnapshot`                | Bundle of browser + process + viewport groups (no page-side fields — see "Forensics gate" below)                                                                                          |
| `ILogEnvInput`                   | `EnvSnapshot`                | Options-object input to `logEnvSnapshot` (`browser`, `page`, `logger`)                                                                                                                    |
| `INIT_FORENSICS_ENV_VAR`         | `InitForensicsGate`          | Name of the env-var that opts into the L7/env forensics envelope. Constant string `PIPELINE_INIT_FORENSICS`.                                                                              |
| `readInitForensicsGate`          | `InitForensicsGate`          | Reader returning `IInitForensicsGateState` (`{ enabled: boolean }`). `enabled` is `true` only when the env-var is `'1'` or `'true'`. Default is OFF so the WAF-passing baseline stays byte-identical. |
| `IInitForensicsGateState`        | `InitForensicsGate`          | Branded gate-state interface — frozen `{ enabled: boolean }` singleton consumed by every observer in `Mediator/Init/**` that needs to self-gate.                                          |

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

## Diagnostic scope (what L4 forensics does — and does NOT — explain)

The transport probe is **diagnostic-only**. It answers the question
"did DNS / TCP / TLS reach the bank from the failing runner?" and
nothing else. It does **not** explain:

- Page rendered but is blank or non-interactive (e.g. SPA never
  hydrated, frame never attached, OTP input never appeared).
- WAF / CDN returned a stub challenge page instead of the real
  login form (no visible banner).
- Geolocation-based content blocks where the response IS HTML
  200, but the body is empty / blocked.
- Headless / bot-detection scripts that strip the DOM after
  initial render.

If the failing screenshot shows a rendered page (even a blank
one), the transport probe will report success at every layer
because L3 / L4 / L7-transport all completed. In that case the
real diagnostic surface is **page state at failure time** (frame
tree, JS console errors, response headers, environment delta) —
covered by the L7 + ENV envelope described below.

Treat this envelope as the _first_ triage step: rule transport
in or out, then move up the stack with the matching envelope.

## L7 page-state envelope (frame tree, console errors, landing response)

The failure snapshot is extended with three L7 fields that capture
page-side state at the moment of failure. Collected by observers
attached alongside the existing `requestfailed` + `lifecycle`
observers in `attachNavObservers` (idempotent attach/detach in the
`runNavigationAttempt` finally block):

- **`frameTree`** — `page.frames()` snapshotted **synchronously**
  in the catch block (before any `await`). Each entry carries
  `name`, `url`, and `isAttached`. Diagnoses the "page rendered
  but main frame is `about:blank` while iframes loaded" pattern
  seen on bot-detected SPAs.
- **`consoleErrors`** — `console.error` + `console.warn` +
  `pageerror` buffered from launch onward (cap: 50 entries,
  oldest dropped). Each entry: `kind`, `text`, `urlLocation`,
  `lineNumber`, `columnNumber`. Catches CSP violations
  (`Refused to execute inline script`), JS exceptions during
  hydration, third-party script breakage (Akamai, Imperva,
  DataDome). These are invisible to L4 forensics.
- **`landingResponse`** — `page.on('response')` capture for the
  LOGIN landing URL (main-frame only, ignores sub-resources +
  iframes, last-wins on redirects). Carries `url`, `status`,
  `headers` (allowlisted: `content-type`, `content-security-policy`,
  `cf-ray`, `set-cookie`, `x-frame-options`, `strict-transport-security`),
  `bodyByteLength`, and `redirectChainLength`. **`set-cookie`
  values are redacted** to `[REDACTED]` (PII safe — cookie name
  preserved). `Option<IResponseInfo>` because the response may
  not have arrived by failure time.

These fields are added to `INavFailureSnapshot` and emitted in
the same `INIT-ACTION-NAV-FAILURE` warn log — no new event type,
no separate log line, no callsite changes.

## `PIPELINE-ENV` log (browser / process / page environment delta)

A second, **success-path-only** log fires once per launch from
`buildSuccessfulLaunch` via `logEnvSnapshot`. Event name:
`PIPELINE-ENV`. Diagnoses the "works locally, fails in CI" class
of bugs where the Camoufox spoofed fingerprint diverges from the
host process — e.g. CI runner egress IP is datacenter-tier and
Camoufox identifies as residential Windows, so the bank challenges.

`IEnvSnapshot` carries the host-side fields split into three groups:

| Group    | Fields                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser  | `browserName`, `browserVersion`                                                                                                                     |
| Process  | `nodeVersion`, `platform`, `arch`, `pid`, `processTimezone`, `processLocale`, `camoufoxHumanize`, `camoufoxDisableCoop`, `camoufoxBlockWebrtc`      |
| Viewport | `viewportWidth`, `viewportHeight`                                                                                                                   |

Process fields are read from `process.versions.node`, `process.platform`,
`process.arch`, `process.pid`, `Intl.DateTimeFormat().resolvedOptions()`.
There is **no** `page.evaluate()` call — see "Forensics gate" below for
why the page-side fingerprint was removed.

**The diagnostic value is the delta** between host process and
Camoufox configuration. Example: `platform=linux`,
`processTimezone=Etc/UTC`, `camoufoxHumanize=true` — host is the
CI runner, Camoufox is configured to humanise. If
`camoufoxHumanize=<unset>` in CI but `true` locally, the launch
matrix lost an env-var on the way to the runner.

**Never-throws contract.** `logEnvSnapshot` is wrapped in
`safeCaptureEnvSnapshot` + `tryEmitEnvSnapshot`. Sub-read
failures fall back to sentinel strings (`'unknown'`,
`'<unset>'`) or `0` for numerics. Logger throws are swallowed.
The function returns the snapshot even when the logger rejected
it — useful for tests, harmless in production.

`CAMOUFOX_HUMANIZE`, `CAMOUFOX_DISABLE_COOP`, `CAMOUFOX_BLOCK_WEBRTC`
env vars are captured as strings; missing env vars are encoded as
`'<unset>'` (matches the failure-snapshot convention).

## Forensics gate (`PIPELINE_INIT_FORENSICS`) — opt-in only

The L7 observers (`captureFrameTree`, `attachConsoleErrorBuffer`,
`attachLandingResponseCollector`) AND the `PIPELINE-ENV` emitter
are now **gated by an env-var** and **default OFF**.

| Gate state                           | Behavior                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `PIPELINE_INIT_FORENSICS` unset      | Observers return frozen no-op sentinels. No `page.on(...)` listeners registered. `logEnvSnapshot` emits no log line. |
| `PIPELINE_INIT_FORENSICS=1` (or `true`) | Observers attach real listeners and capture frame tree / console errors / landing response. `logEnvSnapshot` emits one `PIPELINE-ENV` log line per launch. |

### Why the gate exists

PR #289 originally wired the L7 observers + `page.evaluate()`
fingerprint unconditionally. On the next E2E Real B run the
Hapoalim WAF (Imperva) **escalated** from a frictionless hCaptcha
checkbox to an image-grid challenge (proof in
`hapoalim-home-pre-fail-*.png` artifacts). The likely cause was
the pre-navigation `page.evaluate()` against `about:blank`
combined with the extra Marionette-wire activity from the new
`page.on(...)` listeners — Camoufox spoofs at the C++ level but
cannot mask the wire chatter Playwright generates above it.

The gate restores the byte-identical pre-PR-#289 default while
letting triage runs flip a single env-var to capture the full
envelope. The `page.evaluate()`-based page fingerprint was
removed entirely (not just gated) because it provided no signal
on `about:blank` and its DOM-touch was the highest-risk
perturbation in the envelope.

### How to enable for a triage run

```bash
PIPELINE_INIT_FORENSICS=1 npm run test:e2e:real
```

Or in `workflow_dispatch` inputs for a one-off Real-B run. Do
**not** set the env-var in `.env` files used for production
scrapes.

## Auth-request egress trace (`PIPELINE_AUTH_REQ_TRACE`) — opt-in only

The same pipeline logger that `InitActions.ts` threads through
`createElementMediator` into the network-discovery → auth-failure-watcher
chain also powers a **LOGIN-phase** sibling of the gate above: a PII-safe
trace of the credential-submission request _itself_, not just its response.

### Why the auth-request trace exists

The `AuthFailureWatcher` keys off `page.on('response')`. A request that
**egresses but whose response is dropped or hung** — an interceptor abort, a
WAF silent-drop, or a slow-walked first byte — is therefore **invisible**: the
watcher only ever sees responses that actually arrive. The egress trace closes
that blind spot by observing the request lifecycle directly, so a failing CI
run can be classified as _interceptor-abort_ vs _WAF-drop_ vs _slow_ **from
logs alone** — no rerun required.

The motivating asymmetry: Amex's fixed-password login embeds a Cloudflare JSD
(`/cdn-cgi/challenge-platform/`) sub-request that the otherwise-identical
Isracard login does not. When the JSD handshake or the credentials POST fails
silently, the response-keyed watcher saw nothing; the egress trace now records
it.

### Auth-request events

| Event                  | Fires when                                                  |
| ---------------------- | ---------------------------------------------------------- |
| `login.authreq.sent`   | A request matching the well-known auth POST/PUT egresses.   |
| `login.authreq.failed` | That same auth POST/PUT fails (`page.on('requestfailed')`). |
| `login.jsd.failed`     | A Cloudflare JSD challenge-platform sub-request fails.       |

Each line carries only `{ host, method, ms, errorText }` — `host` via a safe
URL parse, never the full URL or any query string (see
[redaction](redaction.md)).

### Auth-request trace symbols

| Symbol                          | Role                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| `AUTH_REQ_TRACE_ENV_VAR`        | The env-var name (`PIPELINE_AUTH_REQ_TRACE`) that opts the trace in. |
| `readAuthReqTraceGate`          | Reads the env-var, returning an `IAuthReqTraceGateState`.            |
| `IAuthReqTraceGateState`        | Frozen `{ enabled }` gate-state shape the reader returns.            |
| `buildAuthRequestHandler`       | Builds the `request` listener that emits `login.authreq.sent`.       |
| `buildAuthRequestFailedHandler` | Builds the `requestfailed` listener for the `*.failed` events.       |
| `AuthRequestHandler`            | The listener signature `(request) => boolean`.                       |
| `WK_AUTH_POST_OR_PUT_REQUEST`   | Bank-agnostic predicate matching the well-known auth POST/PUT.       |

### Auth-request fingerprint safety

The same Marionette-wire concern from [Why the gate exists](#why-the-gate-exists)
applies. When `AUTH_REQ_TRACE_ENV_VAR` is unset (default), `readAuthReqTraceGate`
reports disabled and **no** `request` / `requestfailed` listener is attached — the
watcher's existing `response` listener is unchanged, so a normal scrape is
byte-identical and adds zero fingerprint surface. A triage run sets the env-var
to attach the two extra listeners on the **same** page the watcher already uses.

```bash
PIPELINE_AUTH_REQ_TRACE=1 npm run test:e2e:real
```

Do **not** set it in `.env` files used for production scrapes.

## Enforcement — 10-LoC cluster for Mediator/Init/\*\*

Every function under `src/Scrapers/Pipeline/Mediator/Init/**` is
capped at 10 effective lines (skipBlankLines, skipComments,
IIFEs counted as a single line) by `eslint.config.mjs` Section 14. The cap is asserted by the canary
`src/Scrapers/Pipeline/EslintCanaries/init-cluster-fn-over-cap.canary.ts`
which pads a single function past the ceiling so `verify.sh`
proves the rule fires on every CI run.

If you add a new file under `Mediator/Init/**`, write helpers
small and named — do not raise the cap and do not add an
`eslint-disable` comment. The pre-commit hook will block you.

## See also

- [Structured events](events.md) — the broader event taxonomy
- [Forensic audit](forensic-audit.md) — the post-mortem story this slots into
- `src/Scrapers/Pipeline/Mediator/Init/NavigationDiagnostics.ts` — snapshot composition
- `src/Scrapers/Pipeline/Mediator/Init/NavigationRequestLifecycle.ts` — lifecycle observer
- `src/Scrapers/Pipeline/Mediator/Init/NavigationTransportProbe.ts` — Node-level probe
- `src/Scrapers/Pipeline/Mediator/Init/InitForensicsGate.ts` — env-var opt-in for L7 + env observability
- `src/Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/AuthReqTrace.ts` — auth-request egress/failure handlers
- `src/Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/AuthReqTraceGate.ts` — `PIPELINE_AUTH_REQ_TRACE` opt-in gate
- `src/Tests/Unit/Pipeline/Mediator/Init/NavigationDiagnostics.test.ts` — snapshot specs
- `src/Tests/Unit/Pipeline/Mediator/Init/NavigationRequestLifecycle.test.ts` — observer specs
- `src/Tests/Unit/Pipeline/Mediator/Init/NavigationTransportProbe.test.ts` — probe specs
