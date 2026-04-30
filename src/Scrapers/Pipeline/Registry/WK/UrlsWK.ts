/**
 * WK URL registry — identity/graphql endpoint URLs keyed by (group, bankHint).
 * Banks populate via `registerWkUrl` at module-load time.
 * Zero bank-name literals in this file (one-way: WK depends on bank data, not code).
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** Return value of registerWkUrl — signals the entry was stored. */
type WasUrlRegistered = boolean;

/** Supported WK URL groups — generic API endpoints. */
export type WKUrlGroup =
  | 'identityBase'
  | 'graphql'
  | 'identity.deviceToken'
  | 'identity.otpPrepare'
  | 'identity.otpVerify'
  | 'identity.getIdToken'
  | 'identity.sessionToken'
  | 'auth.bind'
  | 'auth.assert'
  | 'auth.logout';

/** Internal registry: group -> bankHint -> url string. */
const WK_URLS = new Map<WKUrlGroup, Map<CompanyTypes, string>>();

/**
 * Lookup or create the inner bank map for a URL group.
 * @param group - WK URL group.
 * @returns Inner map.
 */
function bankMapFor(group: WKUrlGroup): Map<CompanyTypes, string> {
  const existing = WK_URLS.get(group);
  if (existing) return existing;
  const created = new Map<CompanyTypes, string>();
  WK_URLS.set(group, created);
  return created;
}

/**
 * Register a URL string for a (group, bankHint) pair.
 * Called by bank-local data files at module-load time.
 * @param group - WK URL group.
 * @param bankHint - Target bank identifier.
 * @param url - Full or relative URL string.
 * @returns True once stored.
 */
export function registerWkUrl(
  group: WKUrlGroup,
  bankHint: CompanyTypes,
  url: string,
): WasUrlRegistered {
  const inner = bankMapFor(group);
  inner.set(bankHint, url);
  return true;
}

/**
 * Resolve a URL string for (group, bankHint).
 * @param group - WK URL group.
 * @param bankHint - Target bank identifier.
 * @returns Procedure carrying the URL string, or fail if unknown.
 */
export function resolveWkUrl(group: WKUrlGroup, bankHint: CompanyTypes): Procedure<string> {
  const inner = WK_URLS.get(group);
  const hit = inner?.get(bankHint);
  if (!hit) return fail(ScraperErrorTypes.Generic, `unknown WK url: ${group}/${bankHint}`);
  return succeed(hit);
}

export { WK_URLS };
