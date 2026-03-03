# Task: Fix Beinleumi Group OTP Submit Button

## Status: Backlog

## Priority: High

## Estimated effort: 30min

## Related: Issue #77

## Context

Beinleumi group banks (beinleumi, otsarHahayal, massad, pagi) use `#continueBtn`
as the OTP submit button. This selector is MISSING from `OTP_SUBMIT_CANDIDATES`
in OtpDetector.ts, causing OTP code to be typed but never submitted.

## Root Cause

`submitOtpInFrame()` iterates `OTP_SUBMIT_CANDIDATES` looking for a submit button.
When no candidate matches, it silently returns (only DEBUG log, no warning).
The 5s `verifyOtpAccepted()` sleep then detects the OTP screen is still visible
→ returns `InvalidOtp`.

## Fix

Add `#continueBtn` to `OTP_SUBMIT_CANDIDATES` in `src/Helpers/OtpDetector.ts`:

```ts
export const OTP_SUBMIT_CANDIDATES: SelectorCandidate[] = [
  { kind: 'xpath', value: '//button[contains(.,"אשר")]' },
  { kind: 'xpath', value: '//button[contains(.,"המשך")]' },
  { kind: 'xpath', value: '//button[contains(.,"אישור")]' },
  { kind: 'xpath', value: '//button[contains(.,"כניסה")]' },
  { kind: 'ariaLabel', value: 'כניסה' },
  { kind: 'css', value: 'button[type="submit"]' },
  { kind: 'css', value: 'input[type="submit"]' },
  { kind: 'css', value: '#continueBtn' }, // Beinleumi group (fibi.co.il)
  { kind: 'css', value: 'input[type="button"]' },
];
```

Also: change `submitOtpInFrame()` to log a WARN (not DEBUG) when no submit button found.

## Key Files

- `src/Helpers/OtpDetector.ts` — OTP_SUBMIT_CANDIDATES, submitOtpInFrame()
- `src/Scrapers/BankRegistry.ts` — BEINLEUMI_SUBMIT config

## Validation

1. Unit tests pass
2. Run Beinleumi real e2e with OTP — code should be submitted and login should succeed
3. Other OTP banks (OneZero) unaffected
