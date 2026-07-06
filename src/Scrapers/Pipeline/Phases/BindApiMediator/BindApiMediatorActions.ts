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
import {
  buildDiscoveredHeaderBag,
  discoverAuthToken,
  installAuthToken,
} from './BindApiMediatorAuth.js';
import { type IBancsCapture, primeBancsSession } from './BindApiMediatorBancs.js';
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
 * Prime the BaNCS session values (SecToken + portfolio refs) from the element
 * mediator's login-capture pool, for banks that declare `bancsSessionCapture`
 * (no-op when no pool or no flag).
 * @param full - Full pipeline context (holds the element mediator + config).
 * @param mediator - Browser-page mediator to enrich.
 * @returns `some(capture)` when stashed, `none()` otherwise.
 */
function primeBancsFromPool(full: IPipelineContext, mediator: IApiMediator): Option<IBancsCapture> {
  if (!isSome(full.mediator)) return none();
  const network = full.mediator.value.network;
  return primeBancsSession(full.config, network, mediator);
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
 * Build a browser-page ApiMediator carrying each `'token'` bank's discovered
 * auth. Discovers the token ONCE over the login pool + live page, builds the
 * opt-in discovered-header bag from the SAME pool, constructs the mediator with
 * that bag as fetch-strategy defaults, then installs the token via `setRawAuth`
 * (which still wins over the bag). Session-cookie banks discover no token and
 * get an empty bag ⇒ byte-identical to a bare mediator.
 * @param ctx - Full pipeline context (carries login page + capture pool).
 * @param page - Live login page for discovery + dispatch.
 * @returns The authorized browser-page mediator.
 */
async function bindMediatorWithAuth(ctx: IPipelineContext, page: Page): Promise<IApiMediator> {
  const pool = loginPool(ctx);
  const token = await discoverAuthToken(ctx.config, { pool, page });
  const bag = buildDiscoveredHeaderBag(ctx.config, pool, token);
  const mediator = createBrowserPageApiMediator(ctx.companyId, page, bag);
  if (token) installAuthToken(token, mediator);
  return mediator;
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
  const mediator = await bindMediatorWithAuth(ctx, pageProc.value);
  await primeClientVersion(ctx.config, pageProc.value, mediator);
  primeSessionTokenFromPool(ctx, mediator);
  primeBancsFromPool(ctx, mediator);
  return succeed({ ...ctx, apiMediator: some(mediator) });
}

export default bindBrowserPageMediator;
export { bindBrowserPageMediator };
