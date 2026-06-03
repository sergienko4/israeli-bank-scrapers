# HOME

Landing-page discovery — find the "Log in" affordance on the bank's home page and signal login-area readiness to the next phase.

| | |
|---|---|
| **Always-on?** | Yes (browser banks) |
| **Owner slot** | `loginAreaReady: boolean`, `mediator.popupInterceptor` invocation |
| **Source** | [`HomePhase.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/Home/HomePhase.ts), [`FindLoginAreaPhase.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/PreLogin/FindLoginAreaPhase.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Resolve the `HOME_STRATEGY` config (visible-text "Log in" / "כניסה ללקוחות" etc.). If the resolved trigger is an `<a target="_blank">` element, capture its `href` into `IHomeDiscovery.navHrefOverride` so `.action` can follow the link in-place instead of clicking. |
| `.action` | Run `PopupInterceptor` first (dismiss privacy banners / "you have a message" modals). Then, **if `navHrefOverride` is set**, call `executor.navigateTo(navHrefOverride)` — clicking a `target="_blank"` link would open a new BrowserContext page and strand the scraper's bound `Page` on the marketing tab (PR #299 root-cause). Otherwise click the resolved login affordance. |
| `.post` | Confirm the URL changed and the next page is interactive. |
| `.final` | Commit `loginAreaReady = true`. |

### `target="_blank"` popup-follow (PR #299)

Banks rendered on the Wix platform (e.g. Isracard marketing site) auto-flip cross-subdomain login links to `<a href="…" target="_blank" rel="noopener">`. Playwright honours `target="_blank"` by opening a new page inside the `BrowserContext`, which leaves the scraper's bound `Page` reference on the original tab. The `.pre` hook detects this pattern via the resolved DOM element's `target` attribute and stashes `href` in `IHomeDiscovery.navHrefOverride`; the `.action` hook then routes through `executor.navigateTo(navHrefOverride)` instead of `click()`. Normal in-place login links (the common case) are unaffected — `navHrefOverride` stays `undefined` and the flow clicks as before.

## Banks that DON'T need HOME

API-direct banks (OneZero, Pepper, PayBox) skip this — they don't have a landing page. They start at [API-DIRECT-CALL](api-direct-call.md).
