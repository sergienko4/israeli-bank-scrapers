// Canary: Phase 6 §13C ErrorLog no-bypass lock — asserts the
// `no-restricted-syntax` rule banning `isPiiRedactionDisabled`
// in ErrorLog.ts fires on any reference (import OR identifier
// usage) inside the locked file. The canary file is scoped into
// §13C alongside ErrorLog.ts so the rule applies to it.
//
// Background: CR cycle-1 #3 caught ErrorLog.ts importing the
// dev-mode bypass flag. Bank error messages are security-
// classified (CodeQL #28) — they MUST always-redact even when
// `PII_REDACTION=off`. The general invariant is now locked in
// ESLint; this canary keeps the rule alive.

declare const isPiiRedactionDisabled: boolean;

export function canaryBypassReference(): boolean {
  return isPiiRedactionDisabled;
}
