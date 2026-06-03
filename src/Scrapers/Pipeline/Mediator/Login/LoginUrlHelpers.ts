/**
 * LOGIN URL helpers — URL parsing + login-path equality.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./LoginPhaseActions.ts}.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/**
 * Parse a URL without throwing — returns false on malformed input.
 * @param url - URL string.
 * @returns Parsed URL or false.
 */
function safeParse(url: string): URL | false {
  try {
    return new URL(url);
  } catch {
    return false;
  }
}

/**
 * Extract the pathname of a URL, stripped of trailing slashes.
 * @param url - URL string.
 * @returns Pathname (no trailing slash unless root).
 */
function loginPathOf(url: string): string {
  const parsed = safeParse(url);
  if (parsed === false) return url;
  const stripped = parsed.pathname.replace(/\/{1,255}$/, '');
  if (stripped.length > 0) return stripped;
  return '/';
}

/**
 * Return true when the browser is still sitting on the original login
 * URL (no redirect happened).
 * @param mediator - Element mediator (for currentUrl).
 * @param input - Pipeline context (for diagnostics.loginUrl).
 * @returns True when URL has not moved off the login path.
 */
function hasStayedOnLoginUrl(mediator: IElementMediator, input: IPipelineContext): boolean {
  const loginUrl = input.diagnostics.loginUrl;
  if (loginUrl.length === 0) return true;
  const currentUrl = mediator.getCurrentUrl();
  if (currentUrl === loginUrl) return true;
  if (currentUrl === `${loginUrl}#`) return true;
  return loginPathOf(loginUrl) === loginPathOf(currentUrl);
}

/**
 * True when the post-submit URL is the SAME login URL — verbatim or
 * with a trailing `#`.
 * @param loginUrl - Captured login URL from HOME.
 * @param currentUrl - Browser URL after the submit.
 * @returns True when the URLs are byte-identical or differ only by `#`.
 */
function isSameLoginLocation(loginUrl: string, currentUrl: string): boolean {
  if (currentUrl === loginUrl) return true;
  if (currentUrl === `${loginUrl}#`) return true;
  return false;
}

export { hasStayedOnLoginUrl, isSameLoginLocation, loginPathOf };
