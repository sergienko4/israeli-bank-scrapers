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

## Resolution guards

A field that resolves to the *wrong* element fails silently: `.fill()` writes nothing,
the form stays client-side invalid, the submit click is a no-op, and the run ends with no
warning and no error. Four guards convert each of those into a loud, greppable failure.

| Guard | Rejects | Event |
|---|---|---|
| `assertEveryFieldResolved` | A login where any field the bank declares never resolved — the page is not the expected form (maintenance screen, interstitial, redesign) | `login.fields_unresolved` |
| `rejectNonFormControl` | An element that cannot hold text — strategy 2 walks up to the nearest *interactive* ancestor, which on a non-form page can be an `<a>` or `<div>` | `login.field_not_form_control` |
| `rejectClaimedTarget` / `findClaimingField` | An element a previously resolved field already claimed, so a positional fallback cannot overwrite a semantically-resolved field | `login.field_collision` |
| `LOGIN_FIELD_RERESOLVE_WAIT` | Nothing — it *retries*. Some banks reveal the second credential input only after the first renders, so the probe polls for the hot-path anchor and returns the moment it appears | — |

Every login field is required — no bank declares an optional one — so an incomplete
discovery is always a failed login, and `assertEveryFieldResolved` fails LOGIN where the
evidence is rather than letting a later phase die on an unrelated error.

`rejectNonFormControl` runs only on the credential-field seam, never on buttons or nav
links, which legitimately resolve to `<a>`/`<button>`. Its predicate is tag-level
(`input` / `textarea`) rather than an input-type allowlist, so every input type —
including `date`, used by dashboard date navigation — stays acceptable.

`LOGIN_FIELD_RERESOLVE_WAIT` bounds that retry (see `Mediator/Timing/LoginTimingConfig.ts`).
The budget is paid only when the field is genuinely absent; a field already present
resolves on the first pass and costs nothing.

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
