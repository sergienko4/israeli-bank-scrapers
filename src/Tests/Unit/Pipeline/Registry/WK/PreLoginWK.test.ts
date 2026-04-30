/**
 * PreLoginWK — pin the reveal-toggle phrases against the live bank UIs.
 * These cases failed once in production (Amex's "כניסה עם סיסמה קבועה"
 * was missing → pre-login resolved NOT_FOUND → wrong form filled). The
 * downloaded site fixtures under `c:/tmp/bank-html/{BANK}/` are the
 * source of truth for the exact text strings each bank shows.
 */

import { WK_PRELOGIN } from '../../../../../Scrapers/Pipeline/Registry/WK/PreLoginWK.js';

/** A WK reveal entry shape (just the bits this test asserts on). */
interface IRevealEntry {
  readonly kind: string;
  readonly value: string;
}

/**
 * Filter REVEAL entries to those of the given kind.
 * @param kind - WK selector kind ("clickableText", "ariaLabel", …).
 * @returns Matching entries.
 */
function entriesByKind(kind: string): readonly IRevealEntry[] {
  return WK_PRELOGIN.REVEAL.filter((entry: IRevealEntry): boolean => entry.kind === kind);
}

/**
 * Whether the WK has a (kind, value) pair.
 * @param kind - WK selector kind.
 * @param value - Hebrew (or other) literal text.
 * @returns True iff present.
 */
function hasReveal(kind: string, value: string): boolean {
  return WK_PRELOGIN.REVEAL.some(
    (entry: IRevealEntry): boolean => entry.kind === kind && entry.value === value,
  );
}

describe('WK_PRELOGIN.REVEAL — bank-specific reveal phrases', () => {
  it('contains Max-style "כניסה עם סיסמה" as clickableText', () => {
    const isPresent = hasReveal('clickableText', 'כניסה עם סיסמה');
    expect(isPresent).toBe(true);
  });

  it('contains Amex-style "כניסה עם סיסמה קבועה" as clickableText', () => {
    const isPresent = hasReveal('clickableText', 'כניסה עם סיסמה קבועה');
    expect(isPresent).toBe(true);
  });

  it('contains Amex-style "כניסה עם סיסמה קבועה" as ariaLabel', () => {
    const isPresent = hasReveal('ariaLabel', 'כניסה עם סיסמה קבועה');
    expect(isPresent).toBe(true);
  });

  it('contains FORM_GATE entries that match a password input', () => {
    const xpaths = WK_PRELOGIN.FORM_GATE.map((entry: IRevealEntry): string => entry.value);
    expect(xpaths).toContain('//input[@type="password"]');
  });

  it('contains a SUBMIT_GATE entry for type=submit', () => {
    const xpaths = WK_PRELOGIN.SUBMIT_GATE.map((entry: IRevealEntry): string => entry.value);
    expect(xpaths).toContain('//button[@type="submit"]');
  });

  it('orders Amex variant before generic Max variant in clickableText list', () => {
    const clickables = entriesByKind('clickableText').map(
      (entry: IRevealEntry): string => entry.value,
    );
    const amexIdx = clickables.indexOf('כניסה עם סיסמה קבועה');
    const maxIdx = clickables.indexOf('כניסה עם סיסמה');
    expect(amexIdx).toBeGreaterThanOrEqual(0);
    expect(maxIdx).toBeGreaterThan(amexIdx);
  });
});
