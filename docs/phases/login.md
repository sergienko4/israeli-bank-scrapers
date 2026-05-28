# LOGIN

Resolve each credential field via the 7-strategy `SelectorResolver`, fill, submit, validate.

| | |
|---|---|
| **Always-on?** | Yes (`ifLoginAlways`) |
| **Owner slot** | `login: Option<{ activeFrame, persistentOtpToken, urlBeforeSubmit }>` |
| **Source** | [`LoginPhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/Login/LoginPhase.ts) + [`LoginPhaseActions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.ts) |

## 7-strategy SelectorResolver

The mediator resolves each field declared in the bank's `LoginConfig` by trying these in order, stopping at the first match:

1. Visible text (label / button text in Hebrew or English)
2. `textContent` walk-up from the visible text node to the nearest interactive ancestor
3. `placeholder` attribute
4. `aria-label`
5. `name` attribute
6. CSS selector (rarely needed — declarative `LoginConfig` should avoid it)
7. XPath fallback

Once the first field is resolved, **FormAnchor** scopes the remaining fields to the discovered `<form>` so multi-form pages don't cross-pollute.

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Resolve `LoginConfig` for the bank; record `urlBeforeSubmit`. |
| `.action` | Resolve every field; fill; click submit; wait for URL change OR known-error indicator. |
| `.post` | Detect `INVALID_PASSWORD` / `WRONG_DETAILS` / `LOGIN_FAILED` markers in the post-submit page; consult `possibleResults` map. |
| `.final` | Commit `login` slot with `activeFrame` + `persistentOtpToken` (if exposed). |

## Failure modes

| `errorType` | Cause |
|---|---|
| `INVALID_PASSWORD` | Wrong credentials — typed correctly, just wrong |
| `WAF_BLOCKED` | Cloudflare challenge after submit — see `errorDetails.suggestions` |
| `TIMEOUT` | Submit succeeded but post-login navigation didn't complete |
| `CHANGE_PASSWORD` | Bank requires password change before continuing |
