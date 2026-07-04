/**
 * Legacy credential-key aliases — backward-compat for renamed keys.
 *
 * <p>Maps a canonical credential key to the legacy key(s) a pre-existing
 * caller may still pass, so old code keeps working after a rename. Yahav's
 * user-code field was once `username` and is now `num`, so accepting the
 * old key keeps `scrape({ username, nationalID, password })` working with
 * no breaking change. No bank declares BOTH a canonical key and its alias
 * (verified in `Definitions.SCRAPERS`), so an alias can never shadow a
 * real field.
 */

import type { ScraperCredentials } from '../../Base/Interface.js';

/** Canonical credential key → accepted legacy key(s), in priority order. */
const LEGACY_CREDENTIAL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  num: ['username'],
};

/**
 * Find a legacy-alias value for a canonical key absent from the bag.
 * @param bag - Raw credential record.
 * @param canonical - Canonical key that is missing.
 * @returns The first present alias value, or undefined when none applies.
 */
function aliasValue(bag: Record<string, unknown>, canonical: string): unknown {
  const aliases = LEGACY_CREDENTIAL_ALIASES[canonical] ?? [];
  const hit = aliases.find((k): boolean => bag[k] !== undefined);
  return hit === undefined ? undefined : bag[hit];
}

/**
 * Fill one canonical key from its legacy alias, returning the (possibly
 * updated) bag. No-op when the canonical key is present or no alias applies.
 * @param bag - Accumulating credential record.
 * @param canonical - Canonical key to fill.
 * @returns The bag, with `canonical` added when an alias supplied a value.
 */
function fillCanonical(bag: Record<string, unknown>, canonical: string): Record<string, unknown> {
  if (bag[canonical] !== undefined) return bag;
  const value = aliasValue(bag, canonical);
  if (value === undefined) return bag;
  return { ...bag, [canonical]: value };
}

/**
 * Populate any canonical credential key from its legacy alias when the
 * canonical key is absent. Returns a shallow copy; supplied keys are kept.
 * @param credentials - User-supplied credentials.
 * @returns Credentials with canonical keys filled from legacy aliases.
 */
function normalizeCredentials<T extends ScraperCredentials>(credentials: T): T {
  const bag: Record<string, unknown> = { ...credentials };
  const canonicals = Object.keys(LEGACY_CREDENTIAL_ALIASES);
  const filled = canonicals.reduce<Record<string, unknown>>(
    (acc, canonical): Record<string, unknown> => fillCanonical(acc, canonical),
    bag,
  );
  return filled as T;
}

export { LEGACY_CREDENTIAL_ALIASES, normalizeCredentials };
