# Configuration

Everything is configured through two typed objects: `ScraperOptions` at
construction time and `ScraperCredentials` at scrape time. Nothing else reads
from disk, and the only environment variables consulted are the operational
ones listed at the bottom of this page.

## Scraper options — `createScraper({ ... })`

| Field | Type | Default | What it controls |
| --- | --- | --- | --- |
| `companyId` | `CompanyTypes` (enum) | **required** | Picks the bank — discriminates pipeline vs legacy path |
| `startDate` | `Date` | **required** | Earliest transaction date to fetch |
| `defaultTimeout` | `number` (ms) | `30000` | Per-phase navigation timeout |
| `navigationRetryCount` | `number` | `0` | Retries on `TIMEOUT` from any phase before failing |
| `browserContext` | `Playwright.BrowserContext` | Camoufox-launched per run | Reuse a shared context for parallel runs |
| `otpCodeRetriever` | `() => Promise<string>` | (none) | **Browser banks** — callback invoked when OTP is required |
| `headless` | `boolean` | `true` | Run Camoufox headless |
| `proxy` | `{ server, username?, password? }` | (none) | Residential proxy override — helps when datacenter IPs get WAF-blocked |

`defaultTimeout` is an **option, not an environment variable**. It bounds each
phase's navigation independently rather than the run as a whole, so a slow
LOGIN does not consume the budget that SCRAPE will need.

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

All optional. These are the **only** environment variables the library reads.

| Variable | Default | Effect |
| --- | --- | --- |
| `PII_REDACTION` | `on` | Set to `off` for real-bank E2E **only**. Unit tests always run with redaction default-on. |
| `MOCK_MODE` | unset | `1` switches `test:mock` to its fixture-driven path |
| `CAMOUFOX_LAUNCH_TIMEOUT_MS` | `300000` | Bounds browser launch — see [Quick Start](quick-start.md#tuning-the-launch) |

## Files written to disk

| Path | Contents |
| --- | --- |
| `~/.cache/camoufox/` | Camoufox browser bundle (~1.3 GB, downloaded on first launch) |
| `<cwd>/pipeline.log` | Pino transcript — PII-redacted |
| `<cwd>/network/*.json` | Captured HTTP bodies — redacted before write |
| `<cwd>/screenshots/*.html` | DOM snapshots per phase — redacted in place |
| `<cwd>/screenshots/*.png` | Raster screenshots — **not redacted** |

!!! warning "PNG screenshots are not redacted"
    Raster images are not OCR-scrubbed. They can contain unredacted PII
    rendered by the bank's own UI. Blur or crop before attaching one to a bug
    report — see [PII redaction](observability/redaction.md).
