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

## Scope-intact disambiguation (in-flight auth settle)

When `.post` finds the scope intact and the URL unchanged, it must tell a genuinely wrong password apart from a login whose auth response is still **in flight** — both present no OTP screen at the instant of the first probe. Amex's AngularJS login iframe is the motivating case: its auth XHR is still pending when the probe runs, so the one-time-code input is not yet painted. The disambiguator therefore **polls** for a progression signal — OTP painted, the password field gone, or the URL navigated — re-probing every `SCOPE_INTACT_POLL_INTERVAL_MS` until a per-bank settle budget elapses. The budget is the bank's `IPipelineBankConfig.scopeIntactSettleBudgetMs` when declared (Amex and Isracard opt into a longer budget for their pending AngularJS round-trip), otherwise `SCOPE_INTACT_SETTLE_BUDGET_DEFAULT_MS` (≈ the single-settle `SCOPE_INTACT_SETTLE_MS`, so non-opted banks see ≤2 probes over the same window). A state that paints OTP / navigates during the budget falls through to the OTP phases; one that never transitions across the whole budget is reported as `INVALID_PASSWORD`, preserving the PR #282 anti-masking guarantee. Each re-probe is page-level, so it observes the iframe's XHR too: the behaviour is identical for Amex (iframe) and Isracard.

## Phase 12d — `Form/Anchor/` & `Form/ErrorDiscovery/` sub-modules

Phase 12d split `FormAnchor.ts` and `FormErrorDiscovery.ts` into focused sub-modules under
`src/Scrapers/Pipeline/Mediator/Form/`. Each sub-module fits the canonical `CLEAN_CODE.md`
cap-10 ESLint ceiling (no new `§19.4b` grandfathers per `pr-guidlines.md` A3.5.2). Browser-context
work is decoupled into dedicated `*Browser.ts` files so every closure can be a single
`querySelectorAll(sel).map(...)` while Node-side bridges fan out parallel `evaluateAll` /
`evaluate` calls and zip the resulting columns back into typed records.

### Anchor (`Form/Anchor/`)

Selector-safe primitives used when emitting CSS / XPath strings from DOM-derived values
(CR PR #345 findings #175 + #179, OWASP A03 — selector injection):

- `escapeCssIdent` — escape a CSS identifier (id / class).
- `escapeCssAttr` — escape a CSS attribute-value (between `"…"`).
- `toXpathLiteral` — turn arbitrary text into a quoted XPath literal (handles `'` and `"` via `concat()`).

Each helper returns a nominal **brand type** (Rule #15 — no raw primitive returns at module
boundaries). The brand carries the same runtime string; the tag prevents accidentally feeding
an unescaped string back into a selector composition:

- `CssIdent` — branded return of `escapeCssIdent`.
- `CssAttr` — branded return of `escapeCssAttr`.
- `XPathLiteral` — branded return of `toXpathLiteral`.

Browser closures + column transport (consumed by `AnchorWalk.ts`):

- `getAncestorTags` — column of `Element.tagName` per ancestor.
- `getAncestorIds` — column of `Element.id`.
- `getAncestorFormFlags` — boolean column (`tagName === 'FORM'`).
- `getAncestorInputCounts` — numeric column of `<input>` descendants.
- `getAncestorNames` — column of `name` attributes.
- `getAncestorStableClasses` — first non-`ng-*` class per ancestor.
- `getAncestorSibInfos` — `{index, count}` of same-tag siblings.
- `IAncestorColumns` — flat-column transport shape from browser to Node.
- `ISibInfo` — single-sibling positional info record.

### ErrorDiscovery (`Form/ErrorDiscovery/`)

Detach-tolerance helper used by every error-discovery probe so benign Playwright detach /
context-destroyed rejections fall through to "no errors" while real bugs still surface
(CR PR #345 findings #183, #186):

- `DETACHED_PATTERNS` — substring catalogue of Playwright detach prose (incl. `Frame detached`).
- `isElementGoneError` — predicate over `unknown` rejections; returns `true` for benign signals.
- `DetachedSignal` — branded boolean returned by `isElementGoneError` (Rule #15 — no raw `boolean` return at module boundaries).

Browser closures + column transport (consumed by `ErrorDiscoveryScan.ts`):

- `getErrorTags` — lowercase tag column of every matched error element.
- `getErrorClasses` — class-attribute column (or `noClass` sentinel).
- `getErrorTexts` — trimmed `textContent` column.
- `getErrorHidden` — boolean column derived from computed style.
- `IErrorColumns` — flat-column transport shape from browser to Node.
- `IErrorClassesArg` — `{sel, noClass}` bundle accepted by `getErrorClasses`.
