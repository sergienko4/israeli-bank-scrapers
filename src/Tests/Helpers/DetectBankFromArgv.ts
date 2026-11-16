/**
 * Test-harness bank detection. Production no longer reads `process.argv`; the
 * Jest setup calls this once per test file so trace artefacts and tests that
 * inspect the active bank keep the `<Bank>.e2e-real.test.ts` convention.
 */

import { KNOWN_BANK_SLUGS } from '../../Scrapers/Pipeline/Types/BankSlugs.js';

/**
 * Build the regex that matches a bank slug in the canonical test-file name
 * `<Bank>.e2e-real.test.ts`.
 * @param slug - Lowercase bank slug.
 * @returns Anchored regex for that slug.
 */
function bankSlugRegex(slug: string): RegExp {
  return new RegExp(String.raw`(^|\W)${slug}\\?\.e2e-real\\?\.test\\?\.ts`);
}

/**
 * Detect the active bank slug from `process.argv` by matching the canonical
 * test-file pattern. Test-only: production receives the bank from the run.
 * @param argv - Process arguments, injectable for tests.
 * @returns Lowercase bank slug, or empty string when no match.
 */
function detectBankFromArgv(argv: readonly string[] = process.argv): string {
  const haystack = argv.join(' ').toLowerCase();
  const match = KNOWN_BANK_SLUGS.find((slug): boolean => bankSlugRegex(slug).test(haystack));
  return match ?? '';
}

export { detectBankFromArgv };

export { KNOWN_BANK_SLUGS } from '../../Scrapers/Pipeline/Types/BankSlugs.js';
