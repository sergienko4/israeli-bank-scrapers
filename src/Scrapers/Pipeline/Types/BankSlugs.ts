/**
 * The banks the trace layer knows, and how a run's bank is recognised.
 *
 * <p>Pure and stateless: nothing here registers or remembers a bank, so an
 * execution can validate its own bank without touching process-global state.
 * Split out of `TraceConfig` so run identity and bank recognition each own one
 * thing.
 */
import type { Brand } from './Brand.js';

/** Lowercase bank slug, or `''` when none is known. */
type BankSlugLower = Brand<string, 'BankSlugLower'>;

/** Whether a slug names a bank the trace layer knows. */
type IsKnownBank = Brand<boolean, 'IsKnownBank'>;

/** Bank slugs the auto-detector recognises in test argv. Lowercase, single token. */
const KNOWN_BANK_SLUGS: readonly string[] = [
  'amex',
  'beinleumi',
  'discount',
  'hapoalim',
  'isracard',
  'leumi',
  'max',
  'massad',
  'mercantile',
  'mizrahi',
  'onezero',
  'otsarhahayal',
  'pagi',
  'paybox',
  'pepper',
  'visacal',
  'yahav',
];

/**
 * Build the regex that matches a bank slug in the canonical test-file name
 * `<Bank>.e2e-real.test.ts`. Extracted to flatten detectBankFromArgv (the
 * codebase forbids nesting `RegExp` inside the loop).
 * @param slug - Lowercase bank slug.
 * @returns Anchored regex for that slug.
 */
function bankSlugRegex(slug: string): RegExp {
  // Slug must be preceded by start-of-string or any non-word char (`\W`)
  // so substrings like `--maxWorkers=2` don't trigger a false match for
  // the `max` slug (the `s` after `max` is a word char), but a real path
  // (`/Tests/E2eReal/isracard.e2e-real.test.ts`) and a jest-flag form
  // (`--testPathPatterns=Isracard\.e2e-real\.test\.ts$`) do match. Each
  // dot is `\\?\.` so we accept BOTH literal and regex-escaped forms.
  return new RegExp(String.raw`(^|\W)${slug}\\?\.e2e-real\\?\.test\\?\.ts`);
}

/**
 * Detect the active bank slug from `process.argv` by matching the canonical
 * test-file pattern `<Bank>.e2e-real.test.ts`. Returns the lowercase slug
 * when matched, else `''` so the caller can decide how to handle it.
 * @returns Lowercase bank slug, or empty string when no match.
 */
export function detectBankFromArgv(): BankSlugLower {
  const haystack = process.argv.join(' ').toLowerCase();
  const match = KNOWN_BANK_SLUGS.find((slug): boolean => bankSlugRegex(slug).test(haystack));
  return (match ?? '') as BankSlugLower;
}

/**
 * Whether `slug` names a bank the trace layer knows. Pure: it registers nothing,
 * so an execution can validate its bank without touching process-global state.
 * @param slug - Bank slug, in any case and with surrounding whitespace.
 * @returns True when the slug is a known bank.
 */
export function isKnownBankSlug(slug: string): IsKnownBank {
  const normalised = slug.trim().toLowerCase();
  const isKnown = normalised.length > 0 && KNOWN_BANK_SLUGS.includes(normalised);
  return isKnown as IsKnownBank;
}

export type { BankSlugLower, IsKnownBank };
export { KNOWN_BANK_SLUGS };
