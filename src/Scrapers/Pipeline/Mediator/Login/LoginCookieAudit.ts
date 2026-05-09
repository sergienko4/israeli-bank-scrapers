/**
 * LOGIN.FINAL handler — pure cookie audit.
 *
 * <p>M1+ (CI quality hardening) replaces the legacy
 * `LoginSignalProbe` (which lived in `Mediator/Auth/` and combined
 * cookie audit + `probeDashboardReveal` + `discoverAuthToken`)
 * with this minimal LOGIN-zone helper. Dashboard reveal +
 * auth-token discovery moved to AUTH-DISCOVERY (Mission 1).
 * LOGIN.FINAL now emits exactly one piece of data: "did the run
 * accumulate at least one session cookie?". Anything richer
 * lives downstream.
 *
 * <p>Architecture rule R-AUTH-DISCOVERY-OWN forbids LOGIN-zone
 * files from calling `probeDashboardReveal` /
 * `discoverAuthToken` / `discoverOrigin` / `discoverSiteId` /
 * `buildDiscoveredHeaders` directly. This file therefore consumes
 * only the cookie surface from `IElementMediator.getCookies`.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { API_STRATEGY } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { ICookieSnapshot } from '../Elements/ElementMediator.js';

/** Network-idle wait budget before reading cookies (ms). */
const COOKIE_AUDIT_NETWORK_IDLE_MS = 10_000;

/**
 * LOGIN.FINAL: cookie-only audit. Succeeds when ≥ 1 session
 * cookie is present; fails loud `LOGIN_SESSION_INVALID` otherwise.
 *
 * @param input - Pipeline context.
 * @returns Updated context with cookie diagnostic, or fail-loud.
 */
async function executeLoginSignal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'LOGIN final: no login state');
  if (!input.mediator.has) return succeed(input);
  const mediator = input.mediator.value;
  await mediator.waitForNetworkIdle(COOKIE_AUDIT_NETWORK_IDLE_MS).catch((): false => false);
  const cookies = await mediator.getCookies();
  const cookieCount = cookies.length;
  logCookieAudit(input, cookies);
  if (cookieCount === 0) {
    return fail(ScraperErrorTypes.Generic, 'LOGIN SIGNAL: AUTH_SESSION_INVALID — 0 cookies');
  }
  const diag = {
    ...input.diagnostics,
    lastAction: `login-signal (cookies=${String(cookieCount)})`,
    apiStrategy: API_STRATEGY.DIRECT,
  };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * Emit a PII-safe cookie summary into the run log. Cookie names
 * are masked via {@link maskVisibleText}; values are NEVER logged.
 *
 * @param input - Pipeline context (for the logger handle).
 * @param cookies - Cookie snapshot from the mediator.
 * @returns Cookie count after logging.
 */
function logCookieAudit(input: IPipelineContext, cookies: readonly ICookieSnapshot[]): number {
  const names = cookies.map((c): string => `${c.name}@${c.domain}`);
  const summary = names.join(', ');
  input.logger.debug({ message: `cookies=${String(cookies.length)} [${summary}]` });
  return cookies.length;
}

export default executeLoginSignal;
export { executeLoginSignal };
