/**
 * AuthFailureWatcher UrlMatchers — URL + status predicates shared by
 * both detection layers.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import type { Brand } from '../../../Types/Brand.js';
import { FAIL_STATUS_MAX, FAIL_STATUS_MIN } from './Types.js';

/** Branded boolean tag — Rule #15 marker for exported predicate results. */
export type AuthMatcherBool = Brand<boolean, 'AuthMatcherBool'>;

/**
 * Test if a URL matches the WellKnown auth-endpoint regex set.
 * @param url - Response URL.
 * @returns True when at least one auth pattern matches.
 */
export function isAuthEndpointUrl(url: string): AuthMatcherBool {
  const isHit = PIPELINE_WELL_KNOWN_API.auth.some((p): boolean => p.test(url));
  return isHit as AuthMatcherBool;
}

/**
 * Test if an HTTP status code falls in the 4xx auth-rejection range.
 * @param status - Response status code.
 * @returns True when status is 400..499 inclusive.
 */
export function isFailureStatusCode(status: number): AuthMatcherBool {
  const isHit = status >= FAIL_STATUS_MIN && status <= FAIL_STATUS_MAX;
  return isHit as AuthMatcherBool;
}
