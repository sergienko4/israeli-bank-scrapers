/**
 * BIND-API-MEDIATOR actions — provision a browser-page ApiMediator.
 *
 * Browser hard-model banks keep their WAF-bypassing browser login, then
 * dispatch post-auth REST calls through the SAME live page. This step
 * builds that page-bound mediator (see {@link createBrowserPageApiMediator})
 * and commits it to `ctx.apiMediator` so the shared ApiDirectScrape driver
 * resolves it exactly like a headless bank's mediator. Zero bank coupling.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IApiMediator } from '../../Mediator/Api/ApiMediator.types.js';
import { createBrowserPageApiMediator } from '../../Mediator/Api/BrowserPageApiMediator.factory.js';
import type { IDiscoveredEndpoint } from '../../Mediator/Network/Types/Endpoint.js';
import type { Option } from '../../Types/Option.js';
import { isSome, none, some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { primeTokenAuth } from './BindApiMediatorAuth.js';
import { primeClientVersion } from './BindApiMediatorClientVersion.js';
import { primeSessionToken } from './BindApiMediatorSessionToken.js';

/**
 * Resolve the live login page from the context's browser slot.
 * @param ctx - Full pipeline context.
 * @returns Page procedure, or a Generic failure when browser is absent.
 */
function resolveLoginPage(ctx: IPipelineContext): Procedure<Page> {
  if (!isSome(ctx.browser)) return fail(ScraperErrorTypes.Generic, 'bind-api-mediator: no browser');
  return succeed(ctx.browser.value.page);
}

/**
 * Prime the session token from the element mediator's login-capture pool, for
 * banks that declare `sessionTokenCapture` (no-op when no pool or no spec).
 * @param full - Full pipeline context (holds the element mediator + config).
 * @param mediator - Browser-page mediator to enrich.
 * @returns `some(token)` when a token was stashed, `none()` otherwise.
 */
function primeSessionTokenFromPool(full: IPipelineContext, mediator: IApiMediator): Option<string> {
  if (!isSome(full.mediator)) return none();
  const network = full.mediator.value.network;
  return primeSessionToken(full.config, network, mediator);
}

/**
 * Read the login-inclusive discovery pool from the element mediator, or the
 * empty array when no element mediator is present (headless pass-through).
 * @param full - Full pipeline context (holds the element mediator).
 * @returns Login-inclusive captures, or empty.
 */
function loginPool(full: IPipelineContext): readonly IDiscoveredEndpoint[] {
  if (!isSome(full.mediator)) return [];
  return full.mediator.value.network.getAllEndpoints();
}

/**
 * Prime the Authorization for `'token'` banks via the 5-tier AuthDiscovery
 * orchestrator over the login capture pool + live page (response bodies first —
 * the value the bank API already accepted). Session-cookie banks ride first-party
 * cookies and no-op.
 * @param ctx - Full pipeline context (carries login page + capture pool).
 * @param page - Live login page for the storage/poll tiers.
 * @param mediator - Browser-page mediator to authorize.
 * @returns True when a token was installed.
 */
async function primeAuth(
  ctx: IPipelineContext,
  page: Page,
  mediator: IApiMediator,
): Promise<boolean> {
  const source = { pool: loginPool(ctx), page };
  return primeTokenAuth(ctx.config, source, mediator);
}

/**
 * Bind a browser-page ApiMediator into the context's apiMediator slot, then
 * prime the Bearer/JWT for `'token'` banks (session-cookie banks ride cookies).
 * Idempotent: a pre-populated slot (headless banks) passes through so the
 * step is safe wherever it runs. Runs in the BIND phase PRE stage — the only
 * stage that receives the full context carrying the live `browser` slot (the
 * sealed ACTION context strips browser/page/mediator by construction).
 * @param ctx - Full pipeline context (carries the live login `browser`).
 * @returns Context carrying the primed browser-page ApiMediator, or failure.
 */
async function bindBrowserPageMediator(
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (isSome(ctx.apiMediator)) return succeed(ctx);
  const pageProc = resolveLoginPage(ctx);
  if (!isOk(pageProc)) return pageProc;
  const mediator = createBrowserPageApiMediator(ctx.companyId, pageProc.value);
  await primeAuth(ctx, pageProc.value, mediator);
  await primeClientVersion(ctx.config, pageProc.value, mediator);
  primeSessionTokenFromPool(ctx, mediator);
  return succeed({ ...ctx, apiMediator: some(mediator) });
}

export default bindBrowserPageMediator;
export { bindBrowserPageMediator };
