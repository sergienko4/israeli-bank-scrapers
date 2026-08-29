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
| `.final` | Classify the landed document, then commit `browser` slot to context. |

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

## Landing document

A status check answers "what did the edge claim?". It cannot answer "what did
the edge actually serve?". Discount's F5/BIG-IP edge has been observed
returning the bank's own branded 404 page under **HTTP 200** — a real
document, 37 KB, whose only heading is `404`. Every gate above is
structurally blind to it: the status is 200, the `<title>` is empty so the
neterror classifier finds nothing, and `detectWafBlock` is wired into the
fetch path rather than navigation. INIT reported success and the run died
three phases later at `HOME.PRE` with "no login nav link found" — literally
true, since the document has two anchors, and completely unattributable.

So INIT also classifies the *document*. `isErrorDocument` counts visible
headings whose entire text is a bare 4xx/5xx code, using
`ERROR_HEADING_SELECTOR` and `ERROR_CODE_PATTERN`; a non-zero count means the
bank rendered its own error page. `errorDocumentMessage` builds the
operator-facing reason, leading with the stable `INIT_ERROR_DOCUMENT_CODE`
token and passing the URL through the standard redactor. The verdict and the
text are branded (`IsErrorDocument`, `ErrorDocumentText`) so neither can be
mistaken for a loose boolean or string downstream.

Three properties matter for a probe that runs on the success path of every
browser bank:

- **It runs at `.final`, not `.post`.** Navigation uses `waitUntil: 'commit'`,
  so at `.post` the body may still be unparsed and the probe would silently
  miss. `.final` already awaits `domcontentloaded`, and the probe runs
  *before* the context is wired, so a mediator and a `loginUrl` are never
  derived from an error document.
- **It is time-bounded.** Playwright dispatches `locator.count()` with
  `kNoTimeout`, so a wedged page would hang it forever — and a `try/catch`
  cannot rescue a promise that never settles. The count is raced against
  `ERROR_HEADING_COUNT_TIMEOUT_MS`.
- **It fails open.** Any driver error, or the deadline expiring, yields a
  count of zero. On 19 banks a false alarm is worse than a missed detection,
  so silence is always the fallback.

The probe takes `ILandingDocumentSource` — the two-method surface it actually
needs — rather than a `Page`, so unit tests need no browser and moving it
behind the element mediator later is an adapter change, not a logic change.

The failure is **terminal**. `isNonRetryable` returns `true` for `init` when
the message carries `INIT_ERROR_DOCUMENT_CODE`: three fetches inside ~20s all
received the same 404 and the condition cleared only minutes later, so a
retry would re-fetch the same document while re-running the non-idempotent
browser launch. The guard is scoped to this one message — every other INIT
failure still retries exactly as it did before.

The selector is evaluated by Playwright, so no unit test can prove what it
does to real bank markup. `LandingDocumentClassification.modeA.test.ts` runs
it with the real engine across the whole captured fixture corpus (banks read
from disk, directories walked recursively) and against the captured Discount
error document, asserting zero matches on the former and one on the latter.

## Failure modes

| Symptom | Likely cause |
|---|---|
| `TIMEOUT` | Bank URL unreachable; increase `defaultTimeout` |
| `GENERIC` "bank edge served HTTP ..." | The bank served 404/410 at `loginUrl` — the entry URL moved, or the bank's edge is serving a branded not-found page to this egress IP |
| `GENERIC` `INIT_ERROR_DOCUMENT ...` | The bank served its own error page under a success status. Usually transient edge trouble; if it persists, the entry URL moved |
| `WAF_BLOCKED` | Cloudflare challenge at the landing page — see [README → WAF Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers#error-types) |
| `GENERIC` "companyId not registered" | The bank is legacy-only — falls back to `SCRAPER_REGISTRY` automatically; if you see this on a Pipeline-registered bank, the registry got out of sync |
