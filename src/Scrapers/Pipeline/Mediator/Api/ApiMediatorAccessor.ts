/**
 * ApiMediatorAccessor — generic narrow of the context's mediator slot to an
 * `IApiMediator`. Contains NO bank-specific logic: any handler running under
 * the Headless Strategy reuses this accessor to avoid duplicating the slot
 * probe. The executor is responsible for populating the slot when headless
 * mode is active; here we only validate and return the value.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IApiMediator } from './ApiMediator.js';

/** Presence flag for an Option-like mediator slot. */
type SlotPresent = boolean;

/** Option-like shape for a mediator slot (present or absent). */
interface IMediatorSlot {
  readonly has?: SlotPresent;
  readonly value?: IApiMediator;
}

/**
 * Narrow a context's apiMediator slot to an `IApiMediator`, or fail.
 * The slot is populated by PipelineContextFactory when the descriptor
 * carries `isHeadless: true`. For HTML banks the slot is `none()` and
 * this accessor returns a labelled Generic failure — handlers that
 * reach here on an HTML bank have a wiring bug, not a data bug.
 * @param ctx - The pipeline or action context.
 * @param label - Label included in the fail message for diagnosis.
 * @returns Mediator Procedure.
 */
function resolveApiMediator(
  ctx: IPipelineContext | IActionContext,
  label: string,
): Procedure<IApiMediator> {
  const asPipeline = ctx as unknown as IPipelineContext;
  const slot = asPipeline.apiMediator as unknown as IMediatorSlot | undefined;
  const has = slot?.has === true;
  const value = slot?.value;
  if (!has || !value) {
    return fail(ScraperErrorTypes.Generic, `${label}: ApiMediator missing on context`);
  }
  return succeed(value);
}

export default resolveApiMediator;
export { resolveApiMediator };
