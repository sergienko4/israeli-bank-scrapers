/**
 * WK URL registry — identity/graphql endpoint URLs keyed by (group, bankHint).
 * Banks populate via `registerWkUrl` at module-load time.
 * Zero bank-name literals in this file (one-way: WK depends on bank data, not code).
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Brand } from '../../Types/Brand.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** Registry write outcome — branded for Rule #15. */
type DidRegister = Brand<boolean, 'WkUrlsDidRegister'>;

/** Supported WK URL groups — generic API endpoints. */
export type WKUrlGroup =
  | 'identityBase'
  | 'graphql'
  | 'identity.deviceToken'
  | 'identity.otpPrepare'
  | 'identity.otpVerify'
  | 'identity.getIdToken'
  | 'identity.sessionToken'
  | 'identity.phoneValidate'
  | 'identity.pinValidation'
  | 'identity.loginBySms'
  | 'auth.bind'
  | 'auth.assert'
  | 'auth.logout'
  | 'data.sync'
  | 'data.getUserHistory'
  | 'data.virtualCardTranRequest';

/** Absolute REST URL declared inline by an api-direct shape (bypasses the WK map). */
export type LiteralUrl = Brand<string, 'WkLiteralUrl'>;

/** A urlTag: either a registered WK group OR an inline absolute URL. */
export type WKUrlOrLiteral = WKUrlGroup | LiteralUrl;

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
export function registerWkUrl(group: WKUrlGroup, bankHint: CompanyTypes, url: string): DidRegister {
  const inner = bankMapFor(group);
  inner.set(bankHint, url);
  return true as DidRegister;
}

/**
 * Type guard: true when the tag is an inline absolute URL, not a WK group.
 * @param tag - urlTag to test.
 * @returns True when the tag begins with the http scheme.
 */
export function isLiteralUrl(tag: WKUrlOrLiteral): tag is LiteralUrl {
  return tag.startsWith('http');
}

/**
 * Brand an absolute REST URL for inline use in an api-direct shape.
 * @param url - Absolute http(s) URL taken from a captured trace.
 * @returns The URL branded as a LiteralUrl.
 */
export function literalUrl(url: string): LiteralUrl {
  return url as LiteralUrl;
}

/**
 * Resolve a URL string for (group, bankHint).
 * @param group - WK URL group, or an inline absolute URL (passthrough).
 * @param bankHint - Target bank identifier.
 * @returns Procedure carrying the URL string, or fail if unknown.
 */
export function resolveWkUrl(group: WKUrlOrLiteral, bankHint: CompanyTypes): Procedure<string> {
  if (isLiteralUrl(group)) return succeed(group);
  const inner = WK_URLS.get(group);
  const hit = inner?.get(bankHint);
  if (!hit) return fail(ScraperErrorTypes.Generic, `unknown WK url: ${group}/${bankHint}`);
  return succeed(hit);
}

export { WK_URLS };
