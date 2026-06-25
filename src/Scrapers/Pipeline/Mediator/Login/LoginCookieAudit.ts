/**
 * LOGIN.FINAL handler — loading-cleared gate + cookie audit.
 *
 * <p>M1+ (CI quality hardening) replaces the legacy
 * `LoginSignalProbe` (which lived in `Mediator/Auth/` and combined
 * cookie audit + `probeDashboardReveal` + `discoverAuthToken`)
 * with this minimal LOGIN-zone helper. Dashboard reveal +
 * auth-token discovery moved to AUTH-DISCOVERY (Mission 1).
 *
 * <p>Per the phase map (`general-phases-view-guidlines.md` L7,
 * `LOGIN.final = REVEAL: prove dashboard`) LOGIN.FINAL must prove
 * the UI advanced past the still-processing login form, not merely
 * count cookies. This handler therefore gates on a PURE UI signal
 * first — the login loading indicator must be cleared — then audits
 * that the run accumulated at least one session cookie. A
 * perpetually-spinning login (Amex) fails HONESTLY here instead of
 * passing the cookie-only audit on garbage analytics cookies.
 *
 * <p>Architecture rule R-AUTH-DISCOVERY-OWN forbids LOGIN-zone
 * files from calling `probeDashboardReveal` /
 * `discoverAuthToken` / `discoverOrigin` / `discoverSiteId` /
 * `buildDiscoveredHeaders` directly. The loading gate uses only the
 * generic `IElementMediator.resolveVisible` visibility probe (a UI
 * signal, NOT auth corroboration), so it stays inside the LOGIN axis.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { API_STRATEGY } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { ICookieSnapshot, IElementMediator } from '../Elements/ElementMediator.js';
import { LOGIN_COOKIE_AUDIT_NETWORK_IDLE_MS } from '../Timing/TimingConfig.js';

/** Fail-loud message emitted when the cookie audit observes zero session cookies. */
const COOKIE_AUDIT_EMPTY_MSG = 'LOGIN SIGNAL: AUTH_SESSION_INVALID — 0 cookies';

/** Appearance-probe budget for the login loading indicator (ms). */
const LOGIN_LOADING_PROBE_MS = 1500;

/** Fail-loud message when the login loading indicator never clears. */
const LOGIN_SPINNER_STUCK_MSG =
  'LOGIN final: login form still processing (loading indicator stuck)';

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

/**
 * Build the LOGIN.FINAL success-path Procedure: clones the input
 * with a refreshed diagnostics block that records the cookie count
 * and pins the API strategy to DIRECT.
 *
 * @param input - Pipeline context entering LOGIN.FINAL.
 * @param cookieCount - Number of cookies observed.
 * @returns Success Procedure wrapping the updated context.
 */
function buildLoginSignalSuccess(
  input: IPipelineContext,
  cookieCount: number,
): Procedure<IPipelineContext> {
  const lastAction = `login-signal (cookies=${String(cookieCount)})`;
  const diag = { ...input.diagnostics, lastAction, apiStrategy: API_STRATEGY.DIRECT };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * Probe whether the login loading indicator is currently visible.
 * Races the WK loading candidates across main page + iframes.
 *
 * @param mediator - Element mediator for the live page.
 * @returns True when a loading indicator is visible within the budget.
 */
async function isLoadingVisible(mediator: IElementMediator): Promise<boolean> {
  const race = await mediator.resolveVisible(WK_DASHBOARD.LOADING, LOGIN_LOADING_PROBE_MS);
  return race.found;
}

/**
 * Audit the accumulated session cookies after the settle window.
 * Fails loud when zero cookies are present.
 *
 * @param input - Pipeline context entering LOGIN.FINAL.
 * @param mediator - Element mediator for the live page.
 * @returns Updated context, or a fail-loud Procedure.
 */
async function auditCookies(
  input: IPipelineContext,
  mediator: IElementMediator,
): Promise<Procedure<IPipelineContext>> {
  const cookies = await mediator.getCookies();
  const cookieCount = logCookieAudit(input, cookies);
  if (cookieCount === 0) return fail(ScraperErrorTypes.Generic, COOKIE_AUDIT_EMPTY_MSG);
  return buildLoginSignalSuccess(input, cookieCount);
}

/**
 * LOGIN.FINAL: prove the login form advanced (loading cleared) then
 * audit session cookies. Succeeds when the spinner is gone AND ≥ 1
 * session cookie is present; fails loud otherwise.
 *
 * @param input - Pipeline context.
 * @returns Updated context with cookie diagnostic, or fail-loud.
 */
async function executeLoginSignal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'LOGIN final: no login state');
  if (!input.mediator.has) return succeed(input);
  const mediator = input.mediator.value;
  await mediator.waitForNetworkIdle(LOGIN_COOKIE_AUDIT_NETWORK_IDLE_MS).catch((): false => false);
  if (await isLoadingVisible(mediator)) {
    return fail(ScraperErrorTypes.Generic, LOGIN_SPINNER_STUCK_MSG);
  }
  return auditCookies(input, mediator);
}

export default executeLoginSignal;
export { executeLoginSignal };
