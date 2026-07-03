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
import type { Option } from '../../Types/Option.js';
import { isSome, none, some } from '../../Types/Option.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
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
 * Bind a browser-page ApiMediator into the context's apiMediator slot, then
 * prime the Bearer/JWT for `'token'` banks (session-cookie banks ride cookies).
 * Idempotent: a pre-populated slot (headless banks) passes through so the
 * step is safe wherever it runs.
 * @param ctx - Sealed action context (the full pipeline object at runtime).
 * @returns Context carrying the primed browser-page ApiMediator, or failure.
 */
async function bindBrowserPageMediator(ctx: IActionContext): Promise<Procedure<IActionContext>> {
  const full = ctx as unknown as IPipelineContext;
  if (isSome(full.apiMediator)) return succeed(ctx);
  const pageProc = resolveLoginPage(full);
  if (!isOk(pageProc)) return pageProc;
  const mediator = createBrowserPageApiMediator(full.companyId, pageProc.value);
  await primeTokenAuth(full.config, pageProc.value, mediator);
  await primeClientVersion(full.config, pageProc.value, mediator);
  primeSessionTokenFromPool(full, mediator);
  const next = { ...full, apiMediator: some(mediator) };
  return succeed(next as unknown as IActionContext);
}

export default bindBrowserPageMediator;
export { bindBrowserPageMediator };
