/**
 * Bootstrap-context builder used by BasePhase for the two pipeline
 * phases that have a browser handle but no mediator yet (INIT) or
 * after the mediator has been torn down (TERMINATE).
 *
 * <p>Extracted from `Pipeline/Types/BasePhase.ts` during Phase 12b.
 * The builder uses an explicit object literal (NO spread) so future
 * additions to {@link IPipelineContext} have to opt in at this
 * single audit point — silent leak through `{ ...ctx }` would
 * defeat the seal-by-construction contract.
 *
 * @see "./ActionContextBuilder.ts" — sibling that delegates here when
 *   the mediator slot is empty.
 */

import { none } from '../../Types/Option.js';
import type { IBootstrapContext, IPipelineContext } from '../../Types/PipelineContext.js';
import { balanceContextSlice } from './BalanceContextSlice.js';

/**
 * Build bootstrap context for INIT/TERMINATE — explicit object literal, NO spread.
 * Has browser (for launch/teardown) but NO mediator, NO executor.
 * @param ctx - Full pipeline context.
 * @returns IBootstrapContext with browser access.
 */
export function buildBootstrapContext(ctx: IPipelineContext): IBootstrapContext {
  return {
    options: ctx.options,
    credentials: ctx.credentials,
    companyId: ctx.companyId,
    logger: ctx.logger,
    diagnostics: ctx.diagnostics,
    config: ctx.config,
    fetchStrategy: ctx.fetchStrategy,
    executor: none(),
    apiMediator: ctx.apiMediator,
    loginFieldDiscovery: ctx.loginFieldDiscovery,
    preLoginDiscovery: ctx.preLoginDiscovery,
    dashboard: ctx.dashboard,
    scrapeDiscovery: ctx.scrapeDiscovery,
    accountDiscovery: ctx.accountDiscovery,
    txnEndpoint: ctx.txnEndpoint,
    dashboardTxnHarvest: ctx.dashboardTxnHarvest,
    authDiscovery: ctx.authDiscovery,
    otpTrigger: ctx.otpTrigger,
    api: ctx.api,
    loginAreaReady: ctx.loginAreaReady,
    ...balanceContextSlice(ctx),
    browser: ctx.browser,
  };
}
