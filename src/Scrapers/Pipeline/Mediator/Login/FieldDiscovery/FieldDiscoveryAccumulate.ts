/**
 * Per-step accumulator + form-anchor discovery helpers.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginFieldDiscovery.ts}.
 */

import type { IFieldConfig } from '../../../../Base/Interfaces/Config/FieldConfig.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { none, type Option } from '../../../Types/Option.js';
import type { LoginFieldKey } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import type { IFormAnchor } from '../../Form/FormAnchor.js';
import type { IFieldContext } from '../../Selector/SelectorResolverPipeline.js';
import type { IDiscoverFieldsArgs } from '../LoginFieldDiscovery.types.js';
import { resolveOneField } from './FieldDiscoveryResolveOne.js';
import {
  FIELD_RESULT_TAG,
  type IAccumulateCallArgs,
  type IAnchorCheckArgs,
  type IFieldAccum,
} from './FieldDiscoveryTypes.js';

/**
 * Accumulate one resolved field into the targets map + emit trace log.
 * @param call - Bundled accumulate arguments.
 * @returns Always `true` so the call expression is a meaningful statement.
 */
export function accumulateField(call: IAccumulateCallArgs): true {
  const key = call.field.credentialKey as LoginFieldKey;
  const tag = FIELD_RESULT_TAG[String(!!call.resolved)];
  call.logger.debug({ field: maskVisibleText(key), result: tag });
  if (call.resolved) call.accum.targets.set(key, call.resolved);
  return true;
}

/**
 * Resolve a field-context via the mediator — extracted so the caller
 * stays inside the 10-LoC ceiling.
 * @param args - Discovery bundle.
 * @param field - Field config to resolve.
 * @returns Procedure wrapping the field context.
 */
async function resolveFieldCtx(
  args: IDiscoverFieldsArgs,
  field: IFieldConfig,
): Promise<Procedure<IFieldContext>> {
  return args.mediator.resolveField(field.credentialKey, field.selectors, args.activeFrame);
}

/**
 * Discover form anchor from the first successfully resolved field.
 * @param args - Discovery bundle.
 * @param field - The field that was just resolved.
 * @returns Option wrapping the form anchor.
 */
async function discoverFormFromField(
  args: IDiscoverFieldsArgs,
  field: IFieldConfig,
): Promise<Option<IFormAnchor>> {
  const fieldCtx = await resolveFieldCtx(args, field);
  if (!fieldCtx.success) return none();
  return args.mediator.discoverForm(fieldCtx.value);
}

/**
 * Discover a form anchor lazily — only when the field resolved AND
 * no anchor has been captured yet.
 * @param args - Discovery bundle.
 * @param check - Anchor-check bundle.
 * @returns Form-anchor option (existing or newly discovered).
 */
export async function maybeDiscoverAnchor(
  args: IDiscoverFieldsArgs,
  check: IAnchorCheckArgs,
): Promise<Option<IFormAnchor>> {
  if (!check.resolved) return check.accum.formAnchor;
  if (check.accum.formAnchor.has) return check.accum.formAnchor;
  return discoverFormFromField(args, check.field);
}

/**
 * Resolve one field and accumulate into the discovery state.
 * @param args - Discovery bundle.
 * @param accum - Running accumulator.
 * @param field - Field to resolve.
 * @returns Updated accumulator.
 */
export async function resolveAndAccumulate(
  args: IDiscoverFieldsArgs,
  accum: IFieldAccum,
  field: IFieldConfig,
): Promise<IFieldAccum> {
  const resolved = await resolveOneField({ args, field, anchor: accum.formAnchor });
  accumulateField({ accum, field, resolved, logger: args.logger });
  const formAnchor = await maybeDiscoverAnchor(args, { accum, field, resolved });
  return { targets: accum.targets, formAnchor };
}
