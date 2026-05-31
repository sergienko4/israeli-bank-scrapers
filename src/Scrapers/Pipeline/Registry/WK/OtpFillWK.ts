/**
 * OTP Fill WellKnown selectors — code input + submit.
 * Used exclusively by OtpFillPhase.
 */

/** OTP code input field patterns. */
const WK_OTP_INPUT = [
  { kind: 'placeholder', value: 'קוד חד פעמי' },
  { kind: 'placeholder', value: 'סיסמה חד פעמית' },
  { kind: 'placeholder', value: 'קוד SMS' },
  { kind: 'placeholder', value: 'יש להקליד סיסמה' },
  { kind: 'xpath', value: '//*[@autocomplete="one-time-code"]//input[1]' },
  { kind: 'xpath', value: '//input[@data-testid="separated-0"]' },
] as const;

/** OTP submit button after code entry. */
const WK_OTP_SUBMIT = [
  { kind: 'xpath', value: '//form[.//*[@autocomplete="one-time-code"]]//button[@type="submit"]' },
  { kind: 'xpath', value: '//button[@type="submit"]' },
  { kind: 'xpath', value: '//input[@type="submit"]' },
  { kind: 'xpath', value: '//form//button' },
  { kind: 'clickableText', value: 'המשך' },
  { kind: 'clickableText', value: 'אישור' },
] as const;

export { WK_OTP_INPUT, WK_OTP_SUBMIT };
