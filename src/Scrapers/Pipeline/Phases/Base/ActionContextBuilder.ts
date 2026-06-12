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
 * Both builders compose THREE typed slices ({@link coreContextSlice},
 * {@link discoveryContextSlice}, and {@link "./BalanceContextSlice.ts" | balanceContextSlice})
 * so the public IBootstrapContext / IActionContext object literal
 * stays declarative without inflating either builder past the project's
 * 10-LoC method cap. Spreading TYPED `Pick<>` slices is safe — TypeScript
 * still rejects unknown IPipelineContext fields because each slice's
 * compile-time shape is closed by the keys array `as const`. Direct
 * `...ctx` spreads remain forbidden (would silently inherit future fields
 * and defeat the seal-by-construction contract that the compiler relies
 * on to reject `resolveField` / `resolveVisible` from inside `action()`).
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

/** Cross-cutting infra keys both bootstrap and sealed contexts always carry. */
const CORE_SLOT_KEYS = [
  'options',
  'credentials',
  'companyId',
  'logger',
  'diagnostics',
  'config',
  'fetchStrategy',
] as const;

type CoreContextSlice = Pick<IPipelineContext, (typeof CORE_SLOT_KEYS)[number]>;

/** Pre-ACTION discovery + handoff outputs visible to every phase context. */
const DISCOVERY_SLOT_KEYS = [
  'apiMediator',
  'loginFieldDiscovery',
  'preLoginDiscovery',
  'dashboard',
  'scrapeDiscovery',
  'accountDiscovery',
  'txnEndpoint',
  'dashboardTxnHarvest',
  'authDiscovery',
  'otpTrigger',
  'api',
  'loginAreaReady',
] as const;

type DiscoveryContextSlice = Pick<IPipelineContext, (typeof DISCOVERY_SLOT_KEYS)[number]>;

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
 * Pick the cross-cutting infra slot keys from a full pipeline context.
 * @param ctx - Full pipeline context.
 * @returns The seven cross-cutting infra slots as a typed Pick<>.
 */
function coreContextSlice(ctx: IPipelineContext): CoreContextSlice {
  const entries = CORE_SLOT_KEYS.map(k => [k, ctx[k]] as const);
  return Object.fromEntries(entries) as CoreContextSlice;
}

/**
 * Pick the post-discovery handoff slot keys from a full pipeline context.
 * @param ctx - Full pipeline context.
 * @returns The twelve post-discovery handoff slots as a typed Pick<>.
 */
function discoveryContextSlice(ctx: IPipelineContext): DiscoveryContextSlice {
  const entries = DISCOVERY_SLOT_KEYS.map(k => [k, ctx[k]] as const);
  return Object.fromEntries(entries) as DiscoveryContextSlice;
}

/**
 * Build bootstrap context for INIT/TERMINATE — composes typed slices, NO `...ctx`.
 * Has browser (for launch/teardown) but NO mediator, NO executor.
 * Co-located with {@link buildActionContext} (the only consumer) so the
 * pair share a single audit point.
 * @param ctx - Full pipeline context.
 * @returns IBootstrapContext with browser access.
 */
export function buildBootstrapContext(ctx: IPipelineContext): IBootstrapContext {
  return {
    ...coreContextSlice(ctx),
    executor: none(),
    ...discoveryContextSlice(ctx),
    ...balanceContextSlice(ctx),
    browser: ctx.browser,
  };
}

/**
 * Build sealed IActionContext — composes typed slices, NO `...ctx`.
 * If mediator exists: sealed (no browser, no mediator, no raw Page).
 * If no mediator (INIT/TERMINATE): returns IBootstrapContext (has browser).
 * @param ctx - Full pipeline context after PRE.
 * @returns Sealed action context.
 */
export function buildActionContext(ctx: IPipelineContext): IActionContext {
  if (!ctx.mediator.has) return buildBootstrapContext(ctx);
  return {
    ...coreContextSlice(ctx),
    executor: extractExecutor(ctx),
    ...discoveryContextSlice(ctx),
    ...balanceContextSlice(ctx),
  };
}
