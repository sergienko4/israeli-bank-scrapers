# TERMINATE

Close the browser, dispose interceptors, and produce the final `IScraperScrapingResult`.

| | |
|---|---|
| **Always-on?** | Yes (`ifBrowser`) |
| **Owner slot** | (none — clean-up phase) |
| **Source** | [`TerminatePhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/Terminate/TerminatePhase.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Read the final context — succeeded or failed. |
| `.action` | Run registered browser cleanups: close `Page` → `BrowserContext` → `Browser`. Persist any pending FixtureCapture writes (`network/*.json`, `screenshots/*.html`). |
| `.post` | Log final outcome via Pino. |
| `.final` | Hand off to `PipelineResult.toResult(procedure)` which produces `IScraperScrapingResult`. |

## What gets persisted

| File | Owner | Redacted? |
|---|---|---|
| `pipeline.log` | Pino transport | ✅ via `PiiRedactor.censor` callback |
| `network/*.json` | `NetworkDiscovery` capture writer | ✅ pre-write through `PiiRedactor` |
| `screenshots/*.html` | `SafeScreenshot` DOM serializer | ✅ in-place text + value scrubs |
| `screenshots/*.png` | `SafeScreenshot` raster | ❌ **not** OCR-redacted — see [Bug Reports](https://github.com/sergienko4/israeli-bank-scrapers#filing-a-bug-report) |

## Cleanup invariants

- If LOGIN failed, BROWSER is still closed (no orphan Camoufox processes).
- If a downstream phase threw an exception (rare — phases should return `Procedure fail`), TERMINATE catches and still closes the browser.
- All Playwright resources are released before `toResult` returns to the caller.
