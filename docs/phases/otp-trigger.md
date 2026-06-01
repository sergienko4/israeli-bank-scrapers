# OTP-TRIGGER

Ask the bank to dispatch the SMS/email OTP code. Runs only when the bank's `LoginConfig` declares OTP support.

| | |
|---|---|
| **Always-on?** | No — opt-in via `ifOtpFillAndTrigger` predicate |
| **Banks that use it** | Beinleumi, Massad, Otsar Hahayal, Pagi (Beinleumi group) — and Hapoalim **conditionally** |
| **Owner slot** | `otpTrigger: Option<IOtpTrigger>` |
| **Source** | [`OtpTriggerPhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/OtpTrigger/OtpTriggerPhase.ts) + [`OtpTriggerPhaseActions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/OtpTrigger/OtpTriggerPhaseActions.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Read `otpConfig` from `LoginConfig`; resolve the "send code" button via visible text. |
| `.action` | Click the trigger; capture the phone-hint string (`***1234`) if the bank shows one. |
| `.post` | Confirm the OTP entry field appeared on the next screen. |
| `.final` | Commit `otpTrigger` with `phoneHint` for downstream `OTP-FILL`. |

## Hapoalim conditional behavior

Hapoalim runs OTP-FILL but **NOT** OTP-TRIGGER — the bank auto-sends the code when it detects an unrecognised device. The `otpCodeRetriever` callback is invoked only when the OTP form actually appears; on remembered devices, the phase is skipped at runtime.

## Canonical helpers

The OTP-TRIGGER and OTP-FILL phases share a small set of low-level Playwright helpers that detect the OTP entry surface, scrape the bank's phone hint, and fire the "send code" trigger button. They live in `src/Scrapers/Pipeline/Mediator/Otp/` and are intentionally Playwright-locator-only so the same flow works across every bank that exposes a standard SMS-OTP step.

- `detectOtpScreen` — returns `true` when an OTP entry field is visible on the current page.
- `extractPhoneHint` — scrapes the masked phone hint (e.g. `***1234`) the bank displays next to the OTP form.
- `findOtpSubmitSelector` — returns the resolved selector for the form's submit button.
- `clickOtpTriggerIfPresent` — clicks the "send SMS" trigger element when the bank shows one (no-op when absent).
- `clickFromCandidates` — internal click helper that walks a SelectorCandidate[] list and clicks the first visible match.

The selector-candidate lists + Hebrew/English text patterns these helpers consult live in `src/Scrapers/Pipeline/Mediator/Otp/OtpDetectorConfig.ts`:

- `OTP_INPUT_CANDIDATES` — selector candidates for the OTP code input box.
- `OTP_SUBMIT_CANDIDATES` — selector candidates for the OTP form submit button.
- `OTP_TEXT_PATTERNS` — Hebrew + English text snippets used to recognise an OTP screen by visible text.
- `SMS_TRIGGER_CANDIDATES` — selector candidates for the "send code" trigger button.
- `PHONE_PATTERN` — regex used by `extractPhoneHint` to match a masked phone hint.
