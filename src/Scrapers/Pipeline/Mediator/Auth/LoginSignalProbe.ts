/**
 * Login signal probe — cookie audit + dashboard REVEAL via mediator.
 * Proves login succeeded by checking session cookies and dashboard state.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { probeDashboardReveal } from '../Dashboard/DashboardDiscovery.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/** Cookie summary string for audit logging. */
type CookieSummary = string;

/**
 * Audit session cookies after login.
 * @param mediator - Element mediator.
 * @param log - Logger.
 * @returns Cookie count.
 */
async function auditCookies(
  mediator: IElementMediator,
  log: IPipelineContext['logger'],
): Promise<number> {
  await mediator.waitForNetworkIdle(10000).catch((): false => false);
  const cookies = await mediator.getCookies();
  const names = cookies.map((c): CookieSummary => `${c.name}@${c.domain}`);
  const summary = names.join(', ');
  const countStr = String(cookies.length);
  log.debug({
    event: 'generic-trace',
    phase: 'LOGIN',
    message: `cookies=${countStr} [${maskVisibleText(summary)}]`,
  });
  const currentUrl = mediator.getCurrentUrl();
  log.debug({
    event: 'navigation',
    phase: 'LOGIN',
    url: maskVisibleText(currentUrl),
    didNavigate: true,
  });
  return cookies.length;
}

/**
 * Execute LOGIN.SIGNAL: cookie audit + REVEAL probe.
 * @param input - Pipeline context.
 * @returns Succeed with diagnostics or fail if no session.
 */
export default async function executeLoginSignal(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'LOGIN final: no login state');
  if (!input.mediator.has) return succeed(input);
  const mediator = input.mediator.value;
  const cookieCount = await auditCookies(mediator, input.logger);
  if (cookieCount === 0) {
    return fail(ScraperErrorTypes.Generic, 'LOGIN SIGNAL: AUTH_SESSION_INVALID — 0 cookies');
  }
  const revealInfo = await probeDashboardReveal(mediator);
  const authToken = await mediator.network.discoverAuthToken();
  const hasAuth = Boolean(authToken);
  const proxyUrl = mediator.network.discoverProxyEndpoint();
  /** Strategy lookup: proxy found → PROXY, else → DIRECT. */
  const strategyMap: Record<string, 'DIRECT' | 'PROXY'> = { true: 'PROXY', false: 'DIRECT' };
  const hasProxy = Boolean(proxyUrl);
  const apiStrategy = strategyMap[String(hasProxy)];
  input.logger.debug({
    event: 'login-signal',
    strategy: apiStrategy,
    authToken: hasAuth,
    cookies: cookieCount,
  });
  const revealStr = maskVisibleText(revealInfo);
  input.logger.debug({
    event: 'generic-trace',
    phase: 'LOGIN',
    message: `signal reveal: ${revealStr}`,
  });
  const diag = {
    ...input.diagnostics,
    lastAction: `login-signal (${revealInfo})`,
    apiStrategy,
    discoveredProxyUrl: proxyUrl || undefined,
  };
  return succeed({ ...input, diagnostics: diag });
}

export { executeLoginSignal };
