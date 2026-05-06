/**
 * Login signal probe — cookie audit + dashboard REVEAL via mediator.
 * Proves login succeeded by checking session cookies and dashboard state.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { API_STRATEGY } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { probeDashboardReveal } from '../Dashboard/DashboardDiscovery.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { discoverAccountsInPool } from './AccountDiscovery.js';
import { verifyPreNavReadiness } from './PreNavReadiness.js';

/** Max wait for the first WK-shaped accounts capture in LOGIN.FINAL. */
const ACCOUNT_TRAFFIC_BUDGET_MS = 15_000;

/**
 * Label the wait result for diagnostics. `false` from
 * `waitForTraffic` = budget timed out; otherwise an endpoint matched.
 * @param matched - waitForTraffic return value.
 * @returns Stable diagnostic label.
 */
function summarizeWait(matched: false | { url: string }): 'timeout' | 'matched' {
  if (matched === false) return 'timeout';
  return 'matched';
}

/**
 * Wait for the first WK-shaped accounts capture, then call the
 * shared `discoverAccountsInPool` handler against pre-nav captures.
 * Replaces the implicit `waitForNetworkIdle` race so late-arriving
 * account responses (Isracard `cardsList`, Discount `UserAccounts`)
 * don't slip past the picker.
 * @param mediator - Element mediator (network surface owner).
 * @param log - Logger.
 * @returns `some({ids, records})` whether or not a capture matched —
 *   the discoverer's request-side fallback covers banks that never
 *   publish a body container, so the wrapped option is always set.
 */
async function runAccountDiscovery(
  mediator: IElementMediator,
  log: IPipelineContext['logger'],
): Promise<IPipelineContext['accountDiscovery']> {
  const matched = await mediator.network.waitForTraffic(
    PIPELINE_WELL_KNOWN_API.accounts,
    ACCOUNT_TRAFFIC_BUDGET_MS,
  );
  const waitOutcome = summarizeWait(matched);
  log.debug({ message: `wk-accounts wait → ${waitOutcome}` });
  const preNav = mediator.network.getPreNavCaptures();
  const accounts = discoverAccountsInPool(preNav);
  return some({ ids: accounts.ids, records: accounts.records });
}

/**
 * Gate the shared account-discovery handler on the builder's
 * `accountDiscoveryAt` pointer. Returns the existing
 * `input.accountDiscovery` (typically `none()`) when this FINAL
 * does NOT own the call, so OTP banks never double-wait the
 * dashboard render.
 * @param input - Pipeline context.
 * @param mediator - Element mediator (network surface owner).
 * @returns Updated discovery option.
 */
async function maybeOwnAccountDiscovery(
  input: IPipelineContext,
  mediator: IElementMediator,
): Promise<IPipelineContext['accountDiscovery']> {
  if (input.accountDiscoveryAt !== 'login') return input.accountDiscovery;
  return runAccountDiscovery(mediator, input.logger);
}

/**
 * Run the pre-nav readiness gate ONLY when this FINAL owns
 * discovery. Returns a no-op success when ownership belongs to
 * OTP-FILL or `'none'`, so the caller can `if (!isOk) return`
 * without a nested branch (max-depth budget).
 * @param input - Pipeline context.
 * @returns Readiness procedure or no-op success.
 */
function enforceReadinessIfOwner(input: IPipelineContext): Procedure<IPipelineContext> {
  if (input.accountDiscoveryAt !== 'login') return succeed(input);
  return verifyPreNavReadiness(input, 'LOGIN');
}

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
  const names = cookies.map((c): string => `${c.name}@${c.domain}`);
  const summary = names.join(', ');
  const countStr = String(cookies.length);
  log.debug({
    message: `cookies=${countStr} [${maskVisibleText(summary)}]`,
  });
  const currentUrl = mediator.getCurrentUrl();
  log.debug({
    url: maskVisibleText(currentUrl),
    didNavigate: true,
  });
  return cookies.length;
}

/**
 * Execute LOGIN.SIGNAL: cookie audit + REVEAL probe. After the .ashx
 * removal, every bank flows through the DIRECT path — no PROXY branch.
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
  // Account discovery — the auth boundary owns the call to the
  // shared handler, BUT only when the builder routed it here. OTP
  // banks defer the same call to OTP-FILL.FINAL so the WK-traffic
  // wait runs exactly once. Non-owners short-circuit before the
  // wait so OTP banks never double-wait the dashboard render.
  const accountDiscovery = await maybeOwnAccountDiscovery(input, mediator);
  const readiness = enforceReadinessIfOwner(input);
  if (!isOk(readiness)) return readiness;
  const revealInfo = await probeDashboardReveal(mediator);
  const authToken = await mediator.network.discoverAuthToken();
  const hasAuth = Boolean(authToken);
  const apiStrategy = API_STRATEGY.DIRECT;
  input.logger.debug({
    strategy: apiStrategy,
    authToken: hasAuth,
    cookies: cookieCount,
  });
  const revealStr = maskVisibleText(revealInfo);
  input.logger.debug({
    message: `signal reveal: ${revealStr}`,
  });
  const diag = {
    ...input.diagnostics,
    lastAction: `login-signal (${revealInfo})`,
    apiStrategy,
  };
  return succeed({ ...input, diagnostics: diag, accountDiscovery });
}

export { executeLoginSignal };
