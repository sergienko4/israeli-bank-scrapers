// Canary: Phase 6 §13 sentinel-literal ban — asserts the
// `no-restricted-syntax` rules covering `'[REDACTED]'` /
// `'[OTP]'` / `'[REDACTION_ERROR]'` Literal nodes fire on any
// per-category PiiRedactor module that hardcodes the literal
// instead of importing the matching constant from Types.ts.
//
// Background: CR cycle-1 #9 caught the literal `'[REDACTED]'`
// hardcoded in tests. The general pattern (hardcoded sentinel
// in any cluster file) was missed because no ESLint rule banned
// it. §13 adds the ban; this canary keeps it alive.
//
// Every line below MUST fire the rule. verify.sh asserts
// errorCount > 0 for this file.

export const canaryRedactedLiteral = '[REDACTED]';
export const canaryOtpLiteral = '[OTP]';
export const canaryErrorLiteral = '[REDACTION_ERROR]';
