# HOME

Landing-page discovery — find the "Log in" affordance on the bank's home page and signal login-area readiness to the next phase.

| | |
|---|---|
| **Always-on?** | Yes (browser banks) |
| **Owner slot** | `loginAreaReady: boolean`, `mediator.popupInterceptor` invocation |
| **Source** | [`HomePhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/Home/HomePhase.ts), [`FindLoginAreaPhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/PreLogin/FindLoginAreaPhase.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Resolve the `HOME_STRATEGY` config (visible-text "Log in" / "כניסה ללקוחות" etc.). If the resolved trigger is an `<a target="_blank">` element, capture its `href` into `IHomeDiscovery.navHrefOverride` so `.action` can follow the link in-place instead of clicking. |
| `.action` | Run `PopupInterceptor` first (dismiss privacy banners / "you have a message" modals). Then, **if `navHrefOverride` is set**, call `executor.navigateTo(navHrefOverride)` — clicking a `target="_blank"` link would open a new BrowserContext page and strand the scraper's bound `Page` on the marketing tab (PR #299 root-cause). Otherwise click the resolved login affordance. |
| `.post` | Confirm the URL changed and the next page is interactive. |
| `.final` | Commit `loginAreaReady = true`. |

### `target="_blank"` popup-follow (PR #299)

Banks rendered on the Wix platform (e.g. Isracard marketing site) auto-flip cross-subdomain login links to `<a href="…" target="_blank" rel="noopener">`. Playwright honours `target="_blank"` by opening a new page inside the `BrowserContext`, which leaves the scraper's bound `Page` reference on the original tab. The `.pre` hook detects this pattern via the resolved DOM element's `target` attribute and stashes `href` in `IHomeDiscovery.navHrefOverride`; the `.action` hook then routes through `executor.navigateTo(navHrefOverride)` instead of `click()`. Normal in-place login links (the common case) are unaffected — `navHrefOverride` stays `undefined` and the flow clicks as before.

### Client-side-crash recovery (PR #347)

Some bank homepages are React/Next.js SPAs that render a top-level error boundary — "Application error: a client-side exception has occurred" — when an async chunk or analytics script throws while the scraper dwells on HOME waiting for the login trigger. The trigger DOM unmounts, so `.pre` passive discovery matches nothing and the phase fails with `HOME PRE: no login nav link found`. Observed for Hapoalim on throttled CI runners; Integration never reproduces it because `HomeLoginAreaSignals.modeA.test.ts` replays captured HTML through `setContent` and so never executes the live page's async chunks or analytics at all.

[`HomeCrashRecovery.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Home/HomeCrashRecovery.ts) wraps `.pre` discovery with a single reload-and-retry heal:

- **Detection** is bank-agnostic — `detectClientCrash` matches the framework's own crash-boundary text via `mediator.countByText` against the `CLIENT_CRASH_MARKERS` config array, never against a provider name, so any SPA bank that crashes this way is covered without special-case branching.
- **Recovery** reloads the homepage **once** via `mediator.navigateTo(baseUrl, { waitUntil: 'networkidle' })` and re-runs passive discovery on the fresh mount. If the reload itself fails (homepage unreachable) the original discovery failure is returned unchanged — retrying on a still-broken page would only repeat it.
- **Idempotent** — the reload restores the homepage's intended initial state; it advances no pipeline progress. On the success path nothing extra runs, and ordinary "no trigger" failures (no crash boundary present) pass straight through after two non-blocking crash probes.

### Soft-404 landings — failure attribution (PR #523)

A bank's CDN or WAF can serve the bank's **own branded error document under HTTP status 200**. Observed for Discount, where an F5 BIG-IP edge answered the homepage request with a 404 page that carried a `200 OK` status line. INIT judges landing health from the HTTP status ([`LandingStatusConfig.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Init/LandingStatusConfig.ts) guards on `404` and `410`), so a soft 404 passes INIT as healthy and HOME then scans an error page for a login link. The phase fails with `HOME PRE: no login nav link found` — accurate about the symptom, silent about the cause, and only distinguishable from real scraper breakage by downloading the forensic bundle.

[`HomeErrorDocument.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Home/HomeErrorDocument.ts) closes that attribution gap:

- **`isErrorDocument`** counts headings whose entire text is a bare HTTP error status (`<h1>404</h1>`, `<h2>503</h2>`), matched by the `ERROR_CODE_PATTERN` regex source at both `h1` and `h2` because error templates disagree about the level. It is a read-only structural probe through `mediator.countBySelector`, and it swallows its own failure — a probe that cannot answer leaves the original message alone.
- **`errorDocumentMessage`** builds the replacement text, keeping the `HOME PRE:` prefix so existing log greps keep matching and naming the URL that served the document.
- **Runs only on the already-failed no-entry path**, so no bank that currently passes can be affected. The `errorType` stays `Generic`; only the message changes.

Recovery is separate: `home` is listed in the sanitization pulse's reload-before-retry map ([`PipelineSanitizationPulse.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Core/Executor/PipelineSanitizationPulse.ts)), so a HOME retry re-fetches the document instead of re-querying the stale one. That reload is gated on the page still being on the bank's origin — a pulse retries the whole phase, and once HOME's ACTION has navigated to the login page a reload would re-run home discovery against a document that never had a home login link.

## Banks that DON'T need HOME

API-direct banks (OneZero, Pepper, PayBox) skip this — they don't have a landing page. They start at [API-DIRECT-CALL](api-direct-call.md).
