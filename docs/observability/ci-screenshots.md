# CI screenshots

CI runs suppress phase screenshots by default so post-authentication pixels never reach a public artifact. This page documents the small allowlist that releases failure-state screenshots from four pre-credential phases — the surfaces operators actually need to diagnose Hapoalim / Isracard / OneZero-style "no element found" failures.

## The default contract

| Environment                  | What [`safeScreenshot`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Common/SafeScreenshot.ts) does |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Local (no `CI` env var)      | Captures every screenshot — same as it always has                                                                              |
| CI (`process.env.CI` truthy) | Suppresses by default, writes a `screenshot suppressed in CI` debug log                                                        |

Suppression is the default-deny posture: post-login screens contain account numbers, balances, customer names, and merchant strings, so a leak would be both PII and a security-review red flag.

## The allowlist

[`BasePhase`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Types/BasePhase.ts) passes `force: true` to `safeScreenshot` for one narrow case: **a failure-stage screenshot taken in a pre-credential phase**. The two filters apply together (AND), and both come from constants colocated in `BasePhase.ts`.

### Allowlisted phases

| Phase         | Why it is safe to capture                                                                 | What you see in the screenshot                                                        |
| ------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `home`        | Bank homepage; no credentials entered yet                                                 | The public landing page, possibly with a WAF challenge if the runner IP is challenged |
| `pre-login`   | Card-bank reveal toggle (Amex / Isracard / Max / VisaCal); no credentials entered yet     | The pre-login surface and reveal interstitial                                         |
| `otp-trigger` | Post-login but only the "we sent you an SMS" prompt                                       | The OTP prompt page; the SMS code itself never reaches the DOM                        |
| `otp-fill`    | OTP input page; capture happens at the failure boundary, **before** the code is submitted | The OTP input field; the entered code is not yet in the DOM at fail-entry             |

### Allowlisted suffixes

| Suffix        | When it fires                                          | Why                                                      |
| ------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `action-fail` | The phase's `action` step returned a failure Procedure | Captures the state the failing action left behind        |
| `post-fail`   | The phase's `post` step returned a failure Procedure   | Captures the state after action but before final wrap-up |
| `final-fail`  | The phase's `final` step returned a failure Procedure  | Captures the last-state-before-context-commit            |

Every success suffix (`pre-done`, `action-done`, `post-done`, `final-done`) and the `pre-fail` boundary stay suppressed in CI. The decision is in the `shouldForceScreenshotInCi(suffix)` helper on `BasePhase`.

### The truth table

| Phase                                               | Stage                            | Local    | CI           |
| --------------------------------------------------- | -------------------------------- | -------- | ------------ |
| `home` (or any allowlisted)                         | `*-fail` (action / post / final) | captured | **captured** |
| `home`                                              | `pre-fail` or `*-done`           | captured | suppressed   |
| `login`, `dashboard`, `scrape`, … (post-credential) | any                              | captured | suppressed   |

## How to find a screenshot in a CI artifact

When a CI run fails and writes a screenshot, the file ends up in the `runs/<bank>/<runId>/screenshots/` directory inside the per-job diag artifact. Locally that maps to `c:/tmp/runs/<bank>/<runId>/screenshots/`. In CI the same tree is zipped as `e2e-real-<Bank>-diag-<runId>.zip` and uploaded as a workflow artifact.

The filename pattern is:

```
<phase>-<suffix>.png
```

For example `home-action-fail.png` after a `home.action` failure on the Hapoalim job.

## Adding a phase to the allowlist

If you need to release screenshots for an additional phase in CI:

1. Verify it is pre-credential or that the screenshot would only ever capture a fail-entry boundary that has no credentials in the DOM. Post-login phases (`dashboard`, `scrape`, `balance-resolve`, `terminate`, `auth-discovery`, `account-resolve`) are NOT safe candidates.
2. Add the phase name to `SCREENSHOT_PHASE_ALLOWLIST_IN_CI` in [`BasePhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Types/BasePhase.ts).
3. Add a row to the [§Allowlisted phases](#allowlisted-phases) table on this page describing the surface and why it is safe.
4. Update the unit suite at [`SafeScreenshot.test.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Tests/Unit/Common/SafeScreenshot.test.ts) if the new phase exercises a code path the existing 9 cases do not cover.

## Why we did not just suppress all and rely on `pipeline.log`

A 32-line `pipeline.log` plus a sub-1 KB diag artifact is sometimes all the operator gets when CI fails on a browser-driven bank. The PR #264 Hapoalim run made that limit concrete: the `resolveVisible` mediator reported `212 locators, fulfilled: 0` and the operator could not tell whether the page was a Cloudflare challenge, a regional block, or a partly-rendered SPA. The allowlist closes that gap without opening the post-login pages.
