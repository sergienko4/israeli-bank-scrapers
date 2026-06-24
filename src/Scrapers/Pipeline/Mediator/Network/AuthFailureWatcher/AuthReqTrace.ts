/**
 * Auth request trace handlers — gated request/requestfailed forensics
 * for response-less credential submissions.
 */

import type { Request } from 'playwright-core';

import type { ScraperLogger } from '../../../Types/Debug.js';
import { WK_AUTH_POST_OR_PUT_REQUEST } from '../DiscoveryEngine/PostInterceptor.js';

/** Request listener signature attached when auth request tracing is ON. */
export type AuthRequestHandler = (request: Request) => boolean;

/** Bundled context shared by request trace handlers. */
interface IAuthReqTraceContext {
  readonly logger: ScraperLogger;
  readonly startedAtMs: number;
}

/**
 * Resolve a URL host without logging the full URL.
 * @param request - Playwright request.
 * @returns Host name or `?` when URL parsing fails.
 */
function safeHost(request: Request): string {
  try {
    return new URL(request.url()).host;
  } catch {
    return '?';
  }
}

/**
 * Build the PII-safe common trace payload.
 * @param ctx - Shared trace context.
 * @param request - Playwright request.
 * @returns Host, method, and elapsed milliseconds.
 */
function buildPayload(
  ctx: IAuthReqTraceContext,
  request: Request,
): Record<string, string | number> {
  const ms = Date.now() - ctx.startedAtMs;
  return { host: safeHost(request), method: request.method(), ms };
}

/**
 * Emit a request-sent auth trace when the request matches WK auth POST/PUT.
 * Always emits `login.req.seen` so every outbound request is visible in the
 * trace, classifying the Amex fork-A vs fork-B diagnostic (no XHR created
 * vs XHR created on a detached target).
 * @param ctx - Shared trace context.
 * @param request - Playwright request.
 * @returns True when a WK-match log line was also emitted.
 */
function handleAuthRequest(ctx: IAuthReqTraceContext, request: Request): boolean {
  const payload = buildPayload(ctx, request);
  ctx.logger.debug({ event: 'login.req.seen', ...payload, resourceType: request.resourceType() });
  if (!WK_AUTH_POST_OR_PUT_REQUEST.matches(request)) return false;
  ctx.logger.debug({ event: 'login.authreq.sent', ...payload });
  return true;
}

/** Cloudflare JSD challenge path. Amex login embeds it; Isracard does not. */
const CHALLENGE_PLATFORM_PATH = '/cdn-cgi/challenge-platform/';

/**
 * Detect a Cloudflare JSD (bot-fingerprint) sub-request by its WAF path.
 * Structural URL check on a forensics path — not interaction code, so the
 * zero-CSS-selector rule does not apply.
 * @param request - Playwright request.
 * @returns True when the URL is a Cloudflare challenge-platform request.
 */
function isChallengePlatformRequest(request: Request): boolean {
  return request.url().includes(CHALLENGE_PLATFORM_PATH);
}

/**
 * Emit a PII-safe requestfailed trace under the supplied event name.
 * @param ctx - Shared trace context.
 * @param request - Playwright request.
 * @param event - Structured event name.
 * @returns Always true (a log line emitted).
 */
function emitRequestFailed(ctx: IAuthReqTraceContext, request: Request, event: string): boolean {
  const errorText = request.failure()?.errorText ?? '';
  ctx.logger.debug({ event, ...buildPayload(ctx, request), errorText });
  return true;
}

/**
 * Emit a requestfailed trace for the failed credentials POST or the
 * Cloudflare JSD handshake — the two login-phase requests whose silent
 * failure the response-keyed watcher cannot see.
 * @param ctx - Shared trace context.
 * @param request - Playwright request.
 * @returns True when a log line emitted.
 */
function handleAuthRequestFailed(ctx: IAuthReqTraceContext, request: Request): boolean {
  if (WK_AUTH_POST_OR_PUT_REQUEST.matches(request)) {
    return emitRequestFailed(ctx, request, 'login.authreq.failed');
  }
  if (isChallengePlatformRequest(request))
    return emitRequestFailed(ctx, request, 'login.jsd.failed');
  return false;
}

/**
 * Build the request listener for gated auth tracing.
 * @param logger - Pipeline logger.
 * @param startedAtMs - Watcher start timestamp.
 * @returns Request listener.
 */
export function buildAuthRequestHandler(
  logger: ScraperLogger,
  startedAtMs: number,
): AuthRequestHandler {
  const ctx = { logger, startedAtMs };
  return (request): boolean => handleAuthRequest(ctx, request);
}

/**
 * Build the requestfailed listener for gated auth tracing.
 * @param logger - Pipeline logger.
 * @param startedAtMs - Watcher start timestamp.
 * @returns Requestfailed listener.
 */
export function buildAuthRequestFailedHandler(
  logger: ScraperLogger,
  startedAtMs: number,
): AuthRequestHandler {
  const ctx = { logger, startedAtMs };
  return (request): boolean => handleAuthRequestFailed(ctx, request);
}
