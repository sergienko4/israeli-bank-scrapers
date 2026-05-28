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
