// Canary: Phase 6 §13 sentinel-literal ban — asserts the
// `no-restricted-syntax` rules covering `'[REDACTED]'` /
// `'[OTP]'` / `'[REDACTION_ERROR]'` / `'[ANY_BRACKET_NAME]'` /
// `'-***'` / `'+***'` / `'***'` Literal nodes fire on any
// per-category PiiRedactor module that hardcodes the literal
// instead of importing the matching constant from Types.ts.
//
// Background: CR cycle-1 #9 caught the literal `'[REDACTED]'`
// hardcoded in tests. CR cycle-2 caught `'-***'` / `'+***'`
// hardcoded in Amount.ts — the original three-name allowlist
// missed the new sentinel shape. §13 now bans the *pattern*
// (any bracket-name or asterisk-sign sentinel), not three
// specific strings. This canary keeps both forms alive.
//
// Every line below MUST fire the rule. verify.sh asserts
// errorCount > 0 for this file.

export const canaryRedactedLiteral = '[REDACTED]';
export const canaryOtpLiteral = '[OTP]';
export const canaryErrorLiteral = '[REDACTION_ERROR]';
export const canaryAmountNegLiteral = '-***';
export const canaryAmountPosLiteral = '+***';
export const canaryAmountBareLiteral = '***';
export const canaryFutureBracketLiteral = '[NEW_HINT]';
