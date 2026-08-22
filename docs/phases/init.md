# INIT

Launch the browser engine, build the initial `IPipelineContext`, navigate to the bank's entry URL.

| | |
|---|---|
| **Always-on?** | Yes (browser banks) |
| **Owner slots** | `browser` (Playwright browser + context + page), `diagnostics.loginUrl`, `diagnostics.loginStartMs` |
| **Source** | [`InitPhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/Init/InitPhase.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Validate `options.companyId` is registered in `PIPELINE_REGISTRY`. Default-deny otherwise. |
| `.action` | Launch Camoufox via `CamoufoxLauncher`, create `BrowserContext` with Hebrew UA + Israel timezone + locale, open `Page`. |
| `.post` | Navigate to the bank's `loginUrl` (from the bank's `PipelineDescriptor`). |
| `.final` | Commit `browser` slot to context. |

## Landing status

Navigation is not "did `page.goto` throw?" — it is "did the bank serve the
document we asked for?". `page.goto` resolves happily on a 404, so INIT reads
the HTTP status off the returned `Response` and refuses to hand a
known-dead page to the phases downstream.

`readLandingStatus` extracts the status defensively (any non-`Response` value
yields the `NO_LANDING_STATUS` sentinel rather than throwing), and
`isTerminalLandingStatus` tests it against `TERMINAL_LANDING_STATUSES`. When
the status is terminal, `landingFailureMessage` builds the operator-facing
reason and INIT fails immediately instead of three phases later. The status
itself is a branded `LandingStatus` so it cannot be confused with an
arbitrary number at a call site.

The terminal set is deliberately **404 and 410 only**. Both assert the
document does not exist and no retry can change that. The tempting additions
are all wrong here:

- **403 / 429 / 503** are how edge WAFs serve a challenge. Challenge
  detection is DOM-based (`detectChallenge`), and the solver is a
  pipeline-wide interceptor rather than an INIT-local step — Hapoalim is on
  record solving an hCaptcha ~1.5s *after* `HOME.PRE`. Failing INIT on those
  statuses would break a bypass that currently works.
- **5xx generally** is transient by definition and already covered by the
  retry path.

The check reads the value `page.goto` already returned, so it attaches no
listener, needs no gate, and adds no fingerprint surface. It runs on every
navigation, unlike the opt-in forensics envelope described in
[INIT navigation forensics](../observability/init-navigation-forensics.md).

## Failure modes

| Symptom | Likely cause |
|---|---|
| `TIMEOUT` | Bank URL unreachable; increase `defaultTimeout` |
| `GENERIC` "bank edge served HTTP ..." | The bank served 404/410 at `loginUrl` — the entry URL moved, or the bank's edge is serving a branded not-found page to this egress IP |
| `WAF_BLOCKED` | Cloudflare challenge at the landing page — see [README → WAF Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers#error-types) |
| `GENERIC` "companyId not registered" | The bank is legacy-only — falls back to `SCRAPER_REGISTRY` automatically; if you see this on a Pipeline-registered bank, the registry got out of sync |
