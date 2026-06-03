/**
 * AccountResolveActions.Final — FINAL telemetry emitter. Extracted
 * from the AccountResolveActions barrel so the per-file LoC cap is
 * honoured (phase-2e-residue split).
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/** First-id label lookup — no `''` fallbacks per project rules. */
const FIRST_ID_LABEL: Record<'true' | 'false', (ids: readonly string[]) => string> = {
  /**
   * Non-empty case — return the head id.
   * @param ids - Resolved id list.
   * @returns First id.
   */
  true: (ids): string => ids[0],
  /**
   * Empty case — sentinel string for telemetry parity.
   * @returns Sentinel.
   */
  false: (): string => 'none',
};

/**
 * Surface the resolved id list from the discovery option.
 * @param ctx - Pipeline context.
 * @returns Resolved id list (possibly empty).
 */
function resolvedIds(ctx: IPipelineContext): readonly string[] {
  const has = ctx.accountDiscovery.has;
  if (!has) return [];
  return ctx.accountDiscovery.value.ids;
}

/**
 * FINAL — resolution telemetry. Idempotent.
 * @param input - Pipeline context.
 * @returns Pass-through success.
 */
function executeAccountResolveFinal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const ids = resolvedIds(input);
  const labelKey = String(ids.length > 0) as 'true' | 'false';
  const firstId = FIRST_ID_LABEL[labelKey](ids);
  input.logger.debug({
    message: `account-resolve.final ids=${String(ids.length)} firstId=${firstId}`,
  });
  const success = succeed(input);
  return Promise.resolve(success);
}

export { executeAccountResolveFinal, FIRST_ID_LABEL };
