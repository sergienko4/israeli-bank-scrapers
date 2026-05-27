# INIT

Launch the browser engine, build the initial `IPipelineContext`, navigate to the bank's entry URL.

| | |
|---|---|
| **Always-on?** | Yes (browser banks) |
| **Owner slots** | `browser` (Playwright browser + context + page), `diagnostics.loginUrl`, `diagnostics.loginStartMs` |
| **Source** | [`InitPhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Phases/Init/InitPhase.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Validate `options.companyId` is registered in `PIPELINE_REGISTRY`. Default-deny otherwise. |
| `.action` | Launch Camoufox via `CamoufoxLauncher`, create `BrowserContext` with Hebrew UA + Israel timezone + locale, open `Page`. |
| `.post` | Navigate to the bank's `loginUrl` (from the bank's `PipelineDescriptor`). |
| `.final` | Commit `browser` slot to context. |

## Failure modes

| Symptom | Likely cause |
|---|---|
| `TIMEOUT` | Bank URL unreachable; increase `defaultTimeout` |
| `WAF_BLOCKED` | Cloudflare challenge at the landing page — see [README → WAF Troubleshooting](https://github.com/sergienko4/israeli-bank-scrapers#error-types) |
| `GENERIC` "companyId not registered" | The bank is legacy-only — falls back to `SCRAPER_REGISTRY` automatically; if you see this on a Pipeline-registered bank, the registry got out of sync |
