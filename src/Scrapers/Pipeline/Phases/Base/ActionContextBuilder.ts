/**
 * Sealed action-context builder — strips browser, page, and mediator
 * access so a phase's ACTION stage can only reach the executor
 * surface and the read-only discovery slices. Browser-free phases
 * (INIT before launch, TERMINATE after teardown) fall back to
 * {@link buildBootstrapContext} (kept in this same module so the
 * pair of builders share a single audit point — no §7e default-export
 * exemption needed, no extra file).
 *
 * <p>Extracted from `Pipeline/Types/BasePhase.ts` during Phase 12b.
 * Both builders use explicit object literals (NO spread) for audit
 * reasons: silently inheriting future IPipelineContext fields would
 * defeat the seal-by-construction contract that the TypeScript
 * compiler relies on to reject `resolveField` / `resolveVisible`
 * from inside `action()`.
 *
 * @see "../../Mediator/Elements/CreateElementMediator.ts" —
 *   {@link extractActionMediator} produces the executor surface.
 */

import { extractActionMediator } from '../../Mediator/Elements/CreateElementMediator.js';
import { none, some } from '../../Types/Option.js';
import type {
  IActionContext,
  IBootstrapContext,
  IPipelineContext,
} from '../../Types/PipelineContext.js';
import { balanceContextSlice } from './BalanceContextSlice.js';

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
 * Build bootstrap context for INIT/TERMINATE — explicit object literal, NO spread.
 * Has browser (for launch/teardown) but NO mediator, NO executor.
 * Co-located with {@link buildActionContext} (the only consumer) so the
 * pair share a single audit point.
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
