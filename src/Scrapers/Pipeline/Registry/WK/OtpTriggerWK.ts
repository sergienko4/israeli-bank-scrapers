/**
 * OTP Trigger WellKnown selectors — trigger button only.
 * Used exclusively by OtpTriggerPhase.
 */

/** OTP trigger — button that sends SMS/voice OTP code to phone. */
const WK_OTP_TRIGGER = [
  { kind: 'clickableText', value: 'שלח קוד' },
  { kind: 'clickableText', value: 'שלח' },
  { kind: 'clickableText', value: 'לקבלת סיסמה חד פעמית' },
  { kind: 'ariaLabel', value: 'שלח' },
  { kind: 'ariaLabel', value: 'שלח קוד' },
  { kind: 'xpath', value: '//button[@type="submit"]' },
  { kind: 'xpath', value: '//input[@type="submit"]' },
  { kind: 'xpath', value: '//button[@type="button"]' },
  { kind: 'xpath', value: '//form//button' },
] as const;

export default WK_OTP_TRIGGER;
export { WK_OTP_TRIGGER };
