/**
 * The banks the trace layer knows, and whether a slug names one.
 *
 * <p>Pure and stateless: nothing here registers or remembers a bank, so an
 * execution can validate its own bank without touching process-global state.
 * Split out of `TraceConfig` so run identity and bank recognition each own one
 * thing.
 */
import { CompanyTypes } from '../../../Definitions.js';
import type { Brand } from './Brand.js';

/** Lowercase bank slug, or `''` when none is known. */
type BankSlugLower = Brand<string, 'BankSlugLower'>;

/** Whether a slug names a bank the trace layer knows. */
type IsKnownBank = Brand<boolean, 'IsKnownBank'>;

/**
 * Bank slugs the trace layer recognises. Derived from the public enum so a
 * new bank cannot be forgotten. Lowercase, single token.
 */
const KNOWN_BANK_SLUGS: ReadonlySet<string> = new Set(
  Object.values(CompanyTypes).map(bank => bank.toLowerCase()),
);

/**
 * Whether `slug` names a bank the trace layer knows. Pure: it registers nothing,
 * so an execution can validate its bank without touching process-global state.
 * @param slug - Bank slug, in any case and with surrounding whitespace.
 * @returns True when the slug is a known bank.
 */
export function isKnownBankSlug(slug: string): IsKnownBank {
  const normalised = slug.trim().toLowerCase();
  const isKnown = normalised.length > 0 && KNOWN_BANK_SLUGS.has(normalised);
  return isKnown as IsKnownBank;
}

export type { BankSlugLower };
