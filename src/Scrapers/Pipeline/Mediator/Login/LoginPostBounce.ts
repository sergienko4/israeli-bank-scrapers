/**
 * LOGIN.POST bounce detector — detects when the post-submit URL landed
 * back on the captured login path.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./LoginPostValidate.ts}.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { isSameLoginLocation, loginPathOf } from './LoginUrlHelpers.js';

/** Sentinel for the "bounce" failure message. */
const BOUNCE_FAIL_MSG_PREFIX = 'LOGIN POST: bounced back to login path';

/**
 * Emit the bounce-detection debug log.
 * @param input - Pipeline context (for the logger handle).
 * @param currentUrl - Browser URL where the bounce was detected.
 * @param loginPath - Pathname of the captured login URL.
 * @returns Always `true`.
 */
function logBounce(input: IPipelineContext, currentUrl: string, loginPath: string): true {
  const masked = maskVisibleText(currentUrl);
  const message = `POST: login bounce detected — still on ${loginPath} (url=${masked})`;
  input.logger.debug({ message });
  return true;
}

/**
 * Build the structured bounce-failure procedure plus the diagnostic log.
 * @param input - Pipeline context.
 * @param currentUrl - Browser URL where the bounce was detected.
 * @param loginPath - Pathname of the captured login URL.
 * @returns Failure procedure tagged `InvalidPassword`.
 */
function buildBounceFailure(
  input: IPipelineContext,
  currentUrl: string,
  loginPath: string,
): IProcedureFailure {
  logBounce(input, currentUrl, loginPath);
  return fail(ScraperErrorTypes.InvalidPassword, `${BOUNCE_FAIL_MSG_PREFIX} ${loginPath}`);
}

/**
 * Decide whether the URL pair triggers a bounce.
 * @param loginUrl - Captured login URL.
 * @param currentUrl - Browser URL after submit.
 * @returns Login path string on bounce, `false` otherwise.
 */
function checkBouncePath(loginUrl: string, currentUrl: string): string | false {
  if (isSameLoginLocation(loginUrl, currentUrl)) return false;
  const loginPath = loginPathOf(loginUrl);
  if (loginPath !== loginPathOf(currentUrl)) return false;
  return loginPath;
}

/**
 * Resolve the bounce URLs + login path, or return false.
 * @param mediator - Element mediator for current URL.
 * @param loginUrl - Captured login URL.
 * @returns Bounce URL pair on match, false otherwise.
 */
function resolveBounceMatch(
  mediator: IElementMediator,
  loginUrl: string,
): { currentUrl: string; loginPath: string } | false {
  const currentUrl = mediator.getCurrentUrl();
  const loginPath = checkBouncePath(loginUrl, currentUrl);
  if (loginPath === false) return false;
  return { currentUrl, loginPath };
}

/**
 * Detects when the post-submit URL landed back on the login path.
 * @param mediator - Element mediator for current URL.
 * @param input - Pipeline context with `diagnostics.loginUrl`.
 * @returns Failure procedure on bounce, false otherwise.
 */
function detectLoginBounce(
  mediator: IElementMediator,
  input: IPipelineContext,
): Procedure<IPipelineContext> | false {
  const loginUrl = input.diagnostics.loginUrl;
  if (loginUrl.length === 0) return false;
  const match = resolveBounceMatch(mediator, loginUrl);
  if (match === false) return false;
  return buildBounceFailure(input, match.currentUrl, match.loginPath);
}

export default detectLoginBounce;
export { detectLoginBounce };
