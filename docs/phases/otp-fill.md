# OTP-FILL

Invoke the user-provided `otpCodeRetriever` callback, fill the returned code into the bank's OTP form, submit.

| | |
|---|---|
| **Always-on?** | No — opt-in via `ifOtpFill` predicate |
| **Banks that use it** | All [OTP-TRIGGER](otp-trigger.md) banks + Hapoalim (conditional) |
| **Owner slot** | `otpFill: Option<IOtpFill>` |
| **Source** | [`OtpFillPhase.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/OtpFill/OtpFillPhase.ts) + [`OtpFillPhaseActions.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Detect the OTP entry field on the current page. If absent (Hapoalim remembered-device case), skip the rest of the phase. |
| `.action` | Call `options.otpCodeRetriever(phoneHint)`; fill the returned code; submit. |
| `.post` | Detect `INVALID_OTP` markers; consult `possibleResults`. |
| `.final` | Commit `otpFill` with success flag. |

## otpCodeRetriever contract

```typescript
type OtpCodeRetriever = (phoneHint?: string) => Promise<string>;
```

- Browser banks pass it via `createScraper({ ..., otpCodeRetriever })` (options).
- API banks pass it via `scraper.scrape({ ..., otpCodeRetriever })` (credentials).
- The callback must return within `defaultTimeout` ms or the phase fails with `TIMEOUT`.

## Failure modes

| `errorType` | Cause |
|---|---|
| `INVALID_OTP` | Wrong or expired code |
| `TWO_FACTOR_RETRIEVER_MISSING` | Bank requires OTP but no callback was provided |
| `TIMEOUT` | Retriever didn't resolve in time |
