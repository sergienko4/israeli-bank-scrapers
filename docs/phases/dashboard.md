# DASHBOARD

Pivot to the dashboard URL, prime the network capture pool by clicking a "show transactions" affordance, and produce a slim `ITxnEndpoint` + per-card txn harvest for SCRAPE.

| | |
|---|---|
| **Always-on?** | Yes (`ifBrowser`) |
| **Owner slots** | `dashboard: Option<IDashboardState>`, `txnEndpoint: Option<ITxnEndpoint>`, `dashboardTxnHarvest: Option<IDashboardTxnHarvest>` |
| **Source** | [`DashboardPhase.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/Dashboard/DashboardPhase.ts) + [`DashboardPhaseActions.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Dashboard/DashboardPhaseActions.ts) |

## Why a separate phase?

The bank's dashboard often shows the previous billing cycle by default, with hidden pagination + a date picker for older cycles. Priming the pool by clicking "show all" / "load history" gets the wide-net network capture that SCRAPE needs. Splitting it from SCRAPE means the dashboard's UI quirks (modal popups, "you have a message" overlays) live in one place.

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Navigate to the dashboard URL (or click a dashboard link if the bank stays SPA-style). |
| `.action` | Run `triggerDashboardUi` — click "show transactions" / "view history" / "expand all"; record the `dashboardClickAt` timestamp. |
| `.post` | Inspect the captured pool to find the bank's txn endpoint (the request whose body looks like a per-account txn list). |
| `.final` | Commit `txnEndpoint` (URL + method + body template) + `dashboardTxnHarvest` (the per-card capture pool sliced from `dashboardClickAt` onward). |

## ITxnEndpoint vs IDashboardTxnHarvest

| Slot | Purpose | Consumer |
|---|---|---|
| `txnEndpoint` | Slim typed endpoint declaration — URL, method, body template, dedup-key field tuple, date-window param tuple | SCRAPE strategies issue replays through it |
| `dashboardTxnHarvest` | The actual captured per-card responses (already body-redacted) | SCRAPE's frozen replay matches replay queries against this pool first; falls back to live re-issue if a card wasn't in the harvest |

## Halt gates

The phase halts (`Procedure fail`) if any of:

- `F-DASH-1` — no clickable dashboard affordance found
- `F-DASH-2` — dashboard navigated but no txn-shaped request was captured
- `F-DASH-3` — multi-account scope detected but no per-card disambiguator field
