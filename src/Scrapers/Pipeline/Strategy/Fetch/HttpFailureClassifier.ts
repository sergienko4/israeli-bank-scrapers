/**
 * Shared failure classifier for the fetch strategies: every non-2xx response,
 * plus any response {@link hasCloudflareChallengeHeader} flags, whatever its
 * status.
 *
 * <p>A Cloudflare block page or challenge means the edge refused the request
 * before it reached the bank, so it surfaces as
 * {@link ScraperErrorTypes.WafBlocked}: `ApiMediator.retry.ts` treats that as
 * terminal, so a refusal never buys a token re-mint or a second OTP. The edge
 * page is never quoted — its footer carries the client IP and a Ray ID. Every
 * other failure keeps the Generic `<VERB> <url> <status>: <snippet>` shape;
 * Pepper's CloudFront 403 must stay Generic because that edge uses it to
 * reject a stale bearer.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import { safeUrlForLog } from './SafeUrlForLog.js';

/** Maximum length of a response-body snippet embedded in an error message. */
const ERROR_BODY_SNIPPET_LEN = 120;

/** Status codes the edge answers a refusal with (4xx); 5xx pages are origin faults. */
const EDGE_REFUSAL_STATUS = { min: 400, max: 499 } as const;

/** An HTML document starts with a tag (doctype, comment or element). */
const HTML_SHAPE = /^\s*</;

/** Lower-case markers that must ALL appear in a Cloudflare block page. */
const CLOUDFLARE_BLOCK_MARKERS = ['cf-error', 'cloudflare'] as const;

/** Response header Cloudflare sets on every challenge page, whatever its status. */
const CLOUDFLARE_MITIGATED_HEADER = 'cf-mitigated';

/** The only value Cloudflare defines for {@link CLOUDFLARE_MITIGATED_HEADER}. */
const CLOUDFLARE_CHALLENGE_VERDICT = 'challenge';

/** Fixed reason quoted instead of the block page body. */
const CLOUDFLARE_BLOCK_REASON = 'blocked by Cloudflare edge (WAF) before reaching the API';

/** Fixed reason quoted instead of the challenge page body. */
const CLOUDFLARE_CHALLENGE_REASON = 'challenged by Cloudflare edge (WAF) before reaching the API';

/** A failed or challenged response, reduced to what classification needs. */
interface IHttpFailure {
  readonly verb: string;
  readonly url: string;
  readonly status: number;
  readonly body: string;
  /** Response headers keyed by lower-case name. */
  readonly headers: Readonly<Record<string, string>>;
}

/** One edge-refusal rule: when it matches, the fixed reason it reports. */
interface IEdgeRefusalRule {
  readonly matches: (failure: IHttpFailure) => boolean;
  readonly reason: string;
}

/**
 * Whether a response body is a Cloudflare block page.
 * @param body - Raw response body text.
 * @returns True for an HTML body carrying every Cloudflare marker.
 */
function isCloudflareBlockPage(body: string): boolean {
  if (!HTML_SHAPE.test(body)) return false;
  const lower = body.toLowerCase();
  return CLOUDFLARE_BLOCK_MARKERS.every((marker): boolean => lower.includes(marker));
}

/**
 * Whether the edge blocked the request — a 4xx Cloudflare block page.
 * Cloudflare's 5xx pages carry the same markers but report an unreachable
 * origin, so they stay Generic.
 * @param failure - The non-2xx response.
 * @returns True when the response is an edge block.
 */
function isCloudflareBlock(failure: IHttpFailure): boolean {
  const isClientError =
    failure.status >= EDGE_REFUSAL_STATUS.min && failure.status <= EDGE_REFUSAL_STATUS.max;
  return isClientError && isCloudflareBlockPage(failure.body);
}

/**
 * Whether the edge served a challenge, which no API client can solve. Only the
 * header is trusted: Cloudflare injects its challenge-platform script into
 * ordinary origin pages too, so no body marker can tell a challenge apart.
 * Cloudflare does not tie the header to a status, so the strategies check it
 * before treating a 2xx as success.
 * @param headers - Response headers keyed by lower-case name.
 * @returns True when the response carries Cloudflare's challenge header.
 */
function hasCloudflareChallengeHeader(headers: Readonly<Record<string, string>>): boolean {
  return headers[CLOUDFLARE_MITIGATED_HEADER] === CLOUDFLARE_CHALLENGE_VERDICT;
}

/**
 * Whether the edge served a challenge instead of the API response.
 * @param failure - The failed or challenged response.
 * @returns True when the response carries Cloudflare's challenge header.
 */
function isCloudflareChallenge(failure: IHttpFailure): boolean {
  return hasCloudflareChallengeHeader(failure.headers);
}

/** Edge-refusal rules, checked in order; the first match wins. */
const EDGE_REFUSAL_RULES: readonly IEdgeRefusalRule[] = [
  { matches: isCloudflareChallenge, reason: CLOUDFLARE_CHALLENGE_REASON },
  { matches: isCloudflareBlock, reason: CLOUDFLARE_BLOCK_REASON },
];

/**
 * Classify a failed or challenged response into a failure Procedure.
 * @param failure - Verb, URL, status, body and headers of the response.
 * @returns WafBlocked with a fixed reason for an edge refusal, otherwise
 *   Generic with a body snippet. Both keep the status prefix.
 */
function classifyHttpFailure<T>(failure: IHttpFailure): Procedure<T> {
  const safeUrl = safeUrlForLog(failure.url);
  const prefix = `${failure.verb} ${safeUrl} ${String(failure.status)}: `;
  const refusal = EDGE_REFUSAL_RULES.find((rule): boolean => rule.matches(failure));
  if (refusal) return fail(ScraperErrorTypes.WafBlocked, prefix + refusal.reason);
  const snippet = failure.body.slice(0, ERROR_BODY_SNIPPET_LEN);
  return fail(ScraperErrorTypes.Generic, prefix + snippet);
}

export type { IHttpFailure };
export {
  classifyHttpFailure,
  CLOUDFLARE_BLOCK_REASON,
  CLOUDFLARE_CHALLENGE_REASON,
  hasCloudflareChallengeHeader,
};
