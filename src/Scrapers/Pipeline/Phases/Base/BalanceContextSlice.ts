/**
 * BALANCE-RESOLVE slot slice — the six context keys both
 * {@link "./ActionContextBuilder.ts" | buildBootstrapContext} and
 * {@link "./ActionContextBuilder.ts" | buildActionContext} carry forward.
 *
 * <p>Hoisted into its own module during Phase 12b so the two builders
 * can share the slot list without forming an import cycle. The
 * "Generic over duplication" project rule explicitly prefers this
 * shared-helper shape over inlining the six keys at each builder.
 *
 * @see "../../Types/PipelineContext.ts" — full IPipelineContext shape.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';

/** The six BALANCE-RESOLVE slot keys both bootstrap and sealed action contexts carry. */
export const BALANCE_SLOT_KEYS = [
  'balanceAccountIdentities',
  'balanceFetchPlan',
  'balanceResponsesByBankAccount',
  'balanceExtracted',
  'balanceValidation',
  'balanceResolution',
] as const;

/** Pick-typed alias for the six BALANCE-RESOLVE slots. */
export type BalanceContextSlice = Pick<IPipelineContext, (typeof BALANCE_SLOT_KEYS)[number]>;

/**
 * Extract the five BALANCE-RESOLVE slots from a full pipeline context.
 * Hoisted so bootstrap + action builders don't drift; matches the
 * "Generic over duplication" project rule.
 *
 * @param ctx - Full pipeline context.
 * @returns Slice of the five balance slots.
 */
export function balanceContextSlice(ctx: IPipelineContext): BalanceContextSlice {
  const entries = BALANCE_SLOT_KEYS.map(k => [k, ctx[k]] as const);
  return Object.fromEntries(entries) as BalanceContextSlice;
}
