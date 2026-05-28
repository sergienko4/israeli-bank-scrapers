# PRE-LOGIN

Opt-in "show login" step for card banks that hide the password field behind a toggle until the user clicks a "Login with password" / "המשך עם סיסמה" link.

| | |
|---|---|
| **Always-on?** | No — opt-in via `ifBrowserAndPreLogin` predicate |
| **Banks that use it** | Amex, Isracard, Max, VisaCal |
| **Owner slot** | `preLoginDiscovery: Option<IPreLoginDiscovery>` |
| **Source** | [`PreLoginPhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/PreLogin/PreLoginPhase.ts) + [`PreLoginActions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/PreLogin/PreLoginActions.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Resolve the `PRE_LOGIN_TRIGGER` config (visible-text anchor). |
| `.action` | Click the trigger; wait for the password field to become visible. |
| `.post` | Confirm the form is interactive. |
| `.final` | Commit `preLoginDiscovery` with the activated form scope. |

## Why a separate phase?

Some card banks (Amex/Isracard) prompt for ID + last 6 digits FIRST, then reveal password on a second screen. Splitting this from `LOGIN` keeps `LoginConfig` declarative — one config object describes "the form once it's interactive", PRE-LOGIN deals with the show/hide.
