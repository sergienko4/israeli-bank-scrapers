/**
 * WK URL registry — identity/graphql endpoint URLs keyed by (group, bankHint).
 * Seeded via `registerWkUrl` at module-load time, then frozen on first `resolveWkUrl`.
 * Zero bank-name literals in this file (one-way: WK depends on bank data, not code).
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import ScraperError from '../../../Base/ScraperError.js';
import type { Brand } from '../../Types/Brand.js';
import type { LiteralUrl, WKUrlOrLiteral } from '../../Types/Domain/WKUrl.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** A URL group after shape validation; branded so raw config strings stay out. */
type RegisteredWkUrlGroup = Brand<string, 'RegisteredWkUrlGroup'>;

/** Internal registry: group -> bankHint -> url string. */
const WK_URLS = new Map<RegisteredWkUrlGroup, Map<CompanyTypes, string>>();

/** Set on first `resolveWkUrl` read; blocks all subsequent `registerWkUrl` writes. */
let isFrozen = false;

/**
 * Mark the URL registry frozen on first read so subsequent registrations fail closed.
 * @returns True once frozen.
 */
function ensureFrozen(): true {
  isFrozen = true;
  return true;
}

/**
 * Lookup or create the inner bank map for a URL group.
 * @param group - WK URL group.
 * @returns Inner map.
 */
function bankMapFor(group: RegisteredWkUrlGroup): Map<CompanyTypes, string> {
  const existing = WK_URLS.get(group);
  if (existing) return existing;
  const created = new Map<CompanyTypes, string>();
  WK_URLS.set(group, created);
  return created;
}

/**
 * Register a URL string for a `(group, bankHint)` pair during module-load seeding.
 * Fails closed with {@link ScraperError} once {@link resolveWkUrl} has frozen the registry.
 * @internal
 * @param group - WK URL group.
 * @param bankHint - Target bank identifier.
 * @param url - Full or relative URL string.
 * @returns True once stored.
 */
export function registerWkUrl(group: string, bankHint: CompanyTypes, url: string): true {
  if (isFrozen) {
    throw new ScraperError(`WK URL registry is frozen; refused ${group}/${bankHint}`);
  }
  const inner = bankMapFor(group as RegisteredWkUrlGroup);
  inner.set(bankHint, url);
  return true;
}

/**
 * Type guard: true when the tag is an inline absolute URL, not a WK group.
 * @param tag - urlTag to test.
 * @returns True when the tag begins with the http scheme.
 */
function isLiteralUrl(tag: WKUrlOrLiteral): tag is LiteralUrl {
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
 * Resolve a URL string for `(group, bankHint)`, freezing the registry on first read.
 * @param group - WK URL group, or an inline absolute URL (passthrough).
 * @param bankHint - Target bank identifier.
 * @returns Procedure carrying the URL string, or fail if unknown.
 */
export function resolveWkUrl(group: string, bankHint: CompanyTypes): Procedure<string> {
  ensureFrozen();
  if (isLiteralUrl(group)) return succeed(group);
  const inner = WK_URLS.get(group as RegisteredWkUrlGroup);
  const hit = inner?.get(bankHint);
  if (!hit) return fail(ScraperErrorTypes.Generic, `unknown WK url: ${group}/${bankHint}`);
  return succeed(hit);
}

/**
 * Clear all registered URLs and lift the freeze flag for isolated unit tests.
 * @internal
 * @returns True after reset.
 */
export function resetWkRegistryForTest(): true {
  WK_URLS.clear();
  isFrozen = false;
  return true;
}

export type { LiteralUrl, WKUrlGroup, WKUrlOrLiteral } from '../../Types/Domain/WKUrl.js';
