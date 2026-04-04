/**
 * Login signal probe — cookie audit + dashboard REVEAL via mediator.
 * Proves login succeeded by checking session cookies and dashboard state.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
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
  log.debug('[LOGIN.SIGNAL] cookies=%d [%s]', cookies.length, summary);
  const currentUrl = mediator.getCurrentUrl();
  log.debug('[LOGIN.SIGNAL] url=%s', currentUrl);
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
  const authFound: Record<string, string> = { true: 'FOUND', false: 'NONE' };
  const authLabel = authFound[String(hasAuth)];
  process.stderr.write(`    [LOGIN.FINAL] authToken=${authLabel}\n`);
  const proxyUrl = mediator.network.discoverProxyEndpoint();
  /** Strategy lookup: proxy found → PROXY, else → DIRECT. */
  const strategyMap: Record<string, 'DIRECT' | 'PROXY'> = { true: 'PROXY', false: 'DIRECT' };
  const hasProxy = Boolean(proxyUrl);
  const apiStrategy = strategyMap[String(hasProxy)];
  process.stderr.write(`    [LOGIN.FINAL] apiStrategy=${apiStrategy}\n`);
  input.logger.debug('[LOGIN.SIGNAL] %s', revealInfo);
  const diag = {
    ...input.diagnostics,
    lastAction: `login-signal (${revealInfo})`,
    apiStrategy,
    discoveredProxyUrl: proxyUrl || undefined,
  };
  return succeed({ ...input, diagnostics: diag });
}

export { executeLoginSignal };
