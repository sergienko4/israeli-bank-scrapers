/**
 * Fetch sub-module — bounce classification policy.
 *
 * Holds the constants and nominal types that decide whether an in-page fetch
 * response was *bounced* (intercepted by a WAF or redirected to a login page)
 * rather than answered. Logic lives in `Bounce.ts`; this file is policy only,
 * mirroring the `LandingDocument` / `LandingDocumentConfig` pair.
 *
 * <p><b>Why the policy is deliberately conservative.</b> A bounce is reported as
 * {@link WafBlockError}, which `BaseScraper` maps to `ScraperErrorTypes.WafBlocked`
 * — and that failure is **terminal**: `Mediator/Api/ApiMediator.retry.ts` returns
 * `false` for it, so the call is never retried. Classifying an origin's own
 * rate-limit or maintenance envelope as a bounce would therefore turn a run that
 * recovers today into a hard failure. The gate in `Bounce.ts` requires the body to
 * be unusable as JSON *before* any signal is consulted, which keeps every
 * currently-parsing response on its existing path.
 */

import type { Brand } from '../../../Types/Brand.js';

/**
 * Why a response was classified as a bounce.
 *
 * The empty string is the "no bounce" value, matching the `WafBlockDescription`
 * convention in `WafDetection.ts`.
 */
export type BounceReason = Brand<string, 'BounceReason'>;

/**
 * Content-type substring that marks a payload the JSON parser can consume.
 *
 * Matched case-insensitively against the whole header so `application/json`,
 * `application/problem+json` and `text/json` all qualify.
 */
export const JSON_TYPE_MARKER = 'json';
