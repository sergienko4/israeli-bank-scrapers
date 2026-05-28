# HOME

Landing-page discovery — find the "Log in" affordance on the bank's home page and signal login-area readiness to the next phase.

| | |
|---|---|
| **Always-on?** | Yes (browser banks) |
| **Owner slot** | `loginAreaReady: boolean`, `mediator.popupInterceptor` invocation |
| **Source** | [`HomePhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/Home/HomePhase.ts), [`FindLoginAreaPhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/FindLoginArea/FindLoginAreaPhase.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Resolve the `HOME_STRATEGY` config (visible-text "Log in" / "כניסה ללקוחות" etc.). |
| `.action` | Run `PopupInterceptor` first (dismiss privacy banners / "you have a message" modals), then click the resolved login affordance. |
| `.post` | Confirm the URL changed and the next page is interactive. |
| `.final` | Commit `loginAreaReady = true`. |

## Banks that DON'T need HOME

API-direct banks (OneZero, Pepper, PayBox) skip this — they don't have a landing page. They start at [API-DIRECT-CALL](api-direct-call.md).
