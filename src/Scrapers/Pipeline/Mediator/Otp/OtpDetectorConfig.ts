/** Phone-hint pattern used by the OtpFill / OtpTrigger frame-scan extractors.
 *
 * Shape `***1` to `*******1234`: the typical bank-rendered hint is 3-7 asterisks
 * followed by 1-4 trailing digits, matched on per-frame body text.
 *
 * Token boundaries: `(?<![\d*])` (leading) and `(?!\d)` (trailing) anchor the
 * pattern so it never returns a partial slice inside a longer masked value —
 * e.g. `***12345` does NOT yield a truncated `***1234` hint.
 *
 * Single source of truth for both OtpFillPhaseActions.extractHintFromFrame and
 * OtpTriggerPhaseActions.extractHintFromFrame. Bounded quantifiers ({3,7} and
 * {1,4}) prevent super-linear backtracking on adversarial input. */
export const PHONE_HINT_PATTERN = /(?<![\d*])\*{3,7}\d{1,4}(?!\d)/;

/** Trailing-digits extractor — paired with {@link PHONE_HINT_PATTERN} to pull
 * the last 1-4 digits out of a matched masked hint. Shared by both Fill and
 * Trigger phase extractors so the digit-window stays in sync. */
export const PHONE_LAST_DIGITS = /(\d{1,4})$/;
