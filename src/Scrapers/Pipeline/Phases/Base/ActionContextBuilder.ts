/**
 * Sealed action-context builder — strips browser, page, and mediator
 * access so a phase's ACTION stage can only reach the executor
 * surface and the read-only discovery slices. Browser-free phases
 * (INIT before launch, TERMINATE after teardown) fall back to
 * {@link "./BootstrapContextBuilder.ts" | buildBootstrapContext}.
 *
 * <p>Extracted from `Pipeline/Types/BasePhase.ts` during Phase 12b.
 * Uses an explicit object literal (NO spread) for the same audit
 * reason as its bootstrap sibling: silently inheriting future
 * IPipelineContext fields would defeat the seal-by-construction
 * contract that the TypeScript compiler relies on to reject
 * `resolveField` / `resolveVisible` from inside `action()`.
 *
 * @see "../../Mediator/Elements/CreateElementMediator.ts" —
 *   {@link extractActionMediator} produces the executor surface.
 */

import { extractActionMediator } from '../../Mediator/Elements/CreateElementMediator.js';
import { none, some } from '../../Types/Option.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import { balanceContextSlice } from './BalanceContextSlice.js';
import { buildBootstrapContext } from './BootstrapContextBuilder.js';

/**
 * Extract sealed executor from full context.
 * Requires both mediator AND browser (for frame registry).
 * @param ctx - Full pipeline context.
 * @returns Option wrapping the action mediator.
 */
export function extractExecutor(ctx: IPipelineContext): IActionContext['executor'] {
  if (!ctx.mediator.has) return none();
  if (!ctx.browser.has) return none();
  const page = ctx.browser.value.page;
  const sealed = extractActionMediator(ctx.mediator.value, page);
  return some(sealed);
}

/**
 * Build sealed IActionContext — NEW object literal, NO spread.
 * If mediator exists: sealed (no browser, no mediator, no raw Page).
 * If no mediator (INIT/TERMINATE): returns IBootstrapContext (has browser).
 * @param ctx - Full pipeline context after PRE.
 * @returns Sealed action context.
 */
export function buildActionContext(ctx: IPipelineContext): IActionContext {
  if (!ctx.mediator.has) return buildBootstrapContext(ctx);
  const executor = extractExecutor(ctx);
  return {
    options: ctx.options,
    credentials: ctx.credentials,
    companyId: ctx.companyId,
    logger: ctx.logger,
    diagnostics: ctx.diagnostics,
    config: ctx.config,
    fetchStrategy: ctx.fetchStrategy,
    executor,
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
  };
}
