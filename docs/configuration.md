# Configuration

Everything is configured through two typed objects: `ScraperOptions` at
construction time and `ScraperCredentials` at scrape time. Nothing else reads
from disk, and the only environment variables consulted are the operational
ones listed at the bottom of this page.

Some fields on `ScraperOptions` are honoured only by the
[Legacy (deprecated)](architecture/legacy.md) scrapers — see
[Options the Pipeline ignores](#options-the-pipeline-ignores).

## Scraper options — `createScraper({ ... })`

| Field | Type | Default | What it controls |
| --- | --- | --- | --- |
| `companyId` | `CompanyTypes` (enum) | **required** | Picks the bank — discriminates pipeline vs legacy path |
| `startDate` | `Date` | **required** | Earliest transaction date to fetch |
| `futureMonthsToScrape` | `number` | bank-specific | How far past today to reach for scheduled transactions |
| `defaultTimeout` | `number` (ms) | `30000` | Per-phase navigation timeout |
| `shouldShowBrowser` | `boolean` | `false` | Show the Camoufox window while scraping |
| `preparePage` | `(page: Page) => Promise<void>` | (none) | Hook run against the page before the pipeline starts |
| `prepareBrowser` | `(browser: Browser) => Promise<void>` | (none) | Hook run against the browser after launch |
| `otpCodeRetriever` | `(phoneHint: string) => Promise<string>` | (none) | **Browser banks** — invoked when OTP is required; `phoneHint` is the masked number the bank says it texted |
| `onAuthFlowComplete` | `(info: IAuthFlowInfo) => void` | (none) | Fires once authentication finishes, before scraping |
| `otpTimeoutMs` | `number` (ms) | bank-specific | How long to wait for `otpCodeRetriever` to resolve |
| `loginLogLevel` | `'info' \| 'trace'` | `'info'` | Raises log detail for the LOGIN phase only |

`defaultTimeout` is an **option, not an environment variable**. It bounds each
phase's navigation independently rather than the run as a whole, so a slow
LOGIN does not consume the budget that SCRAPE will need.

## Options the Pipeline ignores

`ScraperOptions` is one flat type shared by the Pipeline and the
[Legacy (deprecated)](architecture/legacy.md) scrapers, so the compiler accepts
every field for every bank. **Sixteen fields do nothing on a Pipeline bank**, in
three groups. Only the first group warns.

Passing one of the eight legacy-only options for a Pipeline bank emits a Node
process warning at `createScraper` time:

```text
(node:12345) ScraperOptionsWarning: "isracard" runs on the Pipeline, which does not
implement these Legacy (deprecated) scraper options: includeRawTransaction,
shouldCombineInstallments. They are ignored here — only the deprecated non-Pipeline
scrapers (Behatsdaa, Beyahad Bishvilha, Mizrahi) read them, and that path is closed
to new work. Remove them, or see
https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/
```

One warning is emitted per `createScraper` call, listing every offending option
together. Silence it by removing the options. To make it impossible to ignore in
CI, listen for the named warning and escalate:

```typescript
process.on('warning', w => {
  if (w.name === 'ScraperOptionsWarning') {
    console.error(w.message);
    process.exitCode = 1;
  }
});
```

### Legacy-only options

Read solely by the [Legacy (deprecated)](architecture/legacy.md) scrapers.

| Option | What it does on the legacy path |
| --- | --- |
| `includeRawTransaction` | Attaches the unparsed provider row to each transaction |
| `navigationRetryCount` | Retries a phase on `TIMEOUT` before failing |
| `optInFeatures` | Per-bank behaviour flags (Mizrahi only) |
| `outputData` | Suppresses date filtering (Beyahad Bishvilha only) |
| `shouldAddTransactionInformation` | Adds extra per-transaction metadata (Mizrahi only) |
| `shouldCombineInstallments` | Merges instalment rows into one transaction |
| `skipCloseBrowser` | Leaves an externally supplied browser open |
| `storeFailureScreenShotPath` | Writes a screenshot when a scrape fails |

Raw provider payloads **are** available on the Pipeline — set
`FORENSIC_TRACE=true` and read `network/*.json`. See
[Observability](observability/index.md).

### Unimplemented options

Accepted by the type, read by neither path.

| Option | Status |
| --- | --- |
| `usePipeline` | Not read. The registry is Pipeline-first: a bank in `PIPELINE_REGISTRY` always takes the Pipeline, and one outside it never can |
| `verbose` | Not implemented. Use `LOG_LEVEL` or `loginLogLevel` |
| `viewportSize` | Not implemented. The context is created with `viewport: null` |

### Browser lifecycle options

| Option | Status |
| --- | --- |
| `args` | Not read. Launch flags come from the bundled Camoufox profile |
| `browser` | Not read. `launchCamoufox()` creates the browser every run |
| `browserContext` | Not read on the Pipeline, which always creates its own context. The legacy path does honour it |
| `executablePath` | Not read. The bundled Camoufox binary is always used |
| `timeout` | Not read on either path. Use `defaultTimeout` instead, which the Pipeline does honour |

The Pipeline always launches and closes its own Camoufox instance, so it ignores
every option that tries to supply or configure the browser. `browser` and
`browserContext` come from the external-browser arms of the options union;
`args`, `executablePath` and `timeout` sit on `IDefaultBrowserOptions` alongside
`shouldShowBrowser` and `prepareBrowser`, which the Pipeline **does** read.

None of these are covered by the warning above — supplying one is a deliberate
act rather than a leftover flag; see
[issue #540](https://github.com/sergienko4/israeli-bank-scrapers/issues/540)
for the rationale.

## Per-bank credentials — `scraper.scrape({ ... })`

Field names per bank are listed in [Supported institutions](banks/index.md).
They are validated at runtime, so a typo fails fast with a named field rather
than a login timeout.

API-direct banks (OneZero, Pepper, PayBox) additionally accept:

| Field | Purpose |
| --- | --- |
| `phoneNumber` | Digits-only international form (no `+`, no dashes) — e.g. `972000000000`. The mediator rewrites it to each bank's wire format. |
| `otpCodeRetriever` | Passed in **credentials**, not options, for these three banks |
| `otpLongTermToken` | Persistent token returned in `result.persistentOtpToken` — supply it to skip the SMS round-trip on the next run |

The phone-format rewrite is per-bank and automatic; see
[API-DIRECT-CALL](phases/api-direct-call.md) for the normaliser contract.

## Environment variables

All optional.

| Variable | Default | Effect |
| --- | --- | --- |
| `PII_REDACTION` | `on` | Set to `off` for real-bank E2E **only**. It governs the three text artifacts below — `pipeline.log`, `network/*.json`, `screenshots/*.html` — so turning it off means each holds real PII. It does not govern the browser cache or `.png` screenshots, which behave the same in both modes. Unit tests always run with redaction default-on. |
| `FORENSIC_TRACE` | unset | `true` writes the full run folder — `pipeline.log`, `network/*.json`, `screenshots/*.png` — under `RUNS_ROOT`. This is how raw provider payloads are captured on the Pipeline; see [Observability](observability/index.md) |
| `RUNS_ROOT` | `<cwd>` | Parent directory for the forensic run folder — see [PII redaction](observability/redaction.md) |
| `LOG_LEVEL` | pino default | Pino verbosity only; decoupled from `FORENSIC_TRACE` |
| `DUMP_FIXTURES_DIR` | unset | Opt-in DOM `*.html` snapshot capture — see [TERMINATE](phases/terminate.md) |
| `DUMP_SNAPSHOTS` | unset | Opt-in cold-start navigation snapshots — see [INIT navigation forensics](observability/init-navigation-forensics.md) |
| `WINDOW_BACKFILL` | on | `off` is the operator kill-switch; any other value leaves backfill on — see [API-DIRECT-SCRAPE](phases/api-direct-scrape.md) |
| `MOCK_MODE` | unset | `1` switches `test:mock` to its fixture-driven path |
| `CAMOUFOX_LAUNCH_TIMEOUT_MS` | `300000` | Bounds browser launch — see [Quick Start](quick-start.md#tuning-the-launch) |

## Files written to disk

The "Redacted?" column assumes the default `PII_REDACTION=on`. Setting it to
`off` turns each ✅ below into a ❌. The two non-✅ rows are unaffected: the
browser cache holds no scrape output, and `.png` screenshots are never scrubbed
in either mode.

| Path | Contents | Redacted? |
| --- | --- | --- |
| `~/.cache/camoufox/` | Camoufox browser bundle (~1.3 GB, downloaded on first launch) | n/a |
| `<cwd>/pipeline.log` | Pino transcript | ✅ censored before any transport writes |
| `<cwd>/network/*.json` | Captured HTTP bodies | ✅ redacted before write |
| `<cwd>/screenshots/*.html` | DOM snapshots per phase | ✅ redacted in place |
| `<cwd>/screenshots/*.png` | Raster screenshots | ❌ **never** — raster is not OCR-scrubbed |

!!! warning "PNG screenshots are not redacted"
    Raster images are not OCR-scrubbed. They can contain unredacted PII
    rendered by the bank's own UI. Blur or crop before attaching one to a bug
    report — see [PII redaction](observability/redaction.md).
