/**
 * Per-step accumulator + form-anchor discovery helpers.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginFieldDiscovery.ts}.
 */

import type { IFieldConfig } from '../../../../Base/Interfaces/Config/FieldConfig.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { none, type Option, some } from '../../../Types/Option.js';
import type { IResolvedTarget, LoginFieldKey } from '../../../Types/PipelineContext.js';
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

/** Targets accumulated so far — aliased to keep signatures single-line. */
type TargetMap = ReadonlyMap<LoginFieldKey, IResolvedTarget>;

/**
 * Whether two resolutions point at the same element.
 * @param a - First resolution.
 * @param b - Second resolution.
 * @returns True when selector and context match.
 */
function sameTarget(a: IResolvedTarget, b: IResolvedTarget): boolean {
  return a.selector === b.selector && a.contextId === b.contextId;
}

/**
 * Find the credential field that already claimed this element.
 *
 * <p>Two credential fields resolving to one element means a positional
 * fallback claimed an input a semantically-resolved field already owns.
 * Filling both silently overwrites the first, leaving the real field
 * empty and the form invalid — with no error raised anywhere.
 * @param targets - Targets accumulated so far.
 * @param resolved - Candidate resolution to check.
 * @returns Some(owner) when already claimed, none() when free.
 */
export function findClaimingField(
  targets: TargetMap,
  resolved: IResolvedTarget,
): Option<LoginFieldKey> {
  const entries = [...targets];
  const hit = entries.find(([, target]): boolean => sameTarget(target, resolved));
  return hit === undefined ? none() : some(hit[0]);
}

/**
 * Drop a resolution that collides with a previously resolved field.
 *
 * <p>Rejecting is strictly safer than accepting: a missing field fails
 * the login loudly, whereas a duplicated one corrupts a sibling field's
 * value and produces a silent client-side validation stall.
 * @param call - Bundled accumulate arguments.
 * @returns The resolution, or false when it collides with a prior field.
 */
export function rejectClaimedTarget(call: IAccumulateCallArgs): IResolvedTarget | false {
  if (!call.resolved) return false;
  const owner = findClaimingField(call.accum.targets, call.resolved);
  if (!owner.has) return call.resolved;
  const field = maskVisibleText(call.field.credentialKey);
  call.logger.warn({ event: 'login.field_collision', field, claimedBy: owner.value });
  return false;
}

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
 * Resolve one field, then drop it when a previously resolved field
 * already claimed the same element.
 * @param args - Discovery bundle.
 * @param accum - Running accumulator.
 * @param field - Field to resolve.
 * @returns Accepted resolution, or false when missing or colliding.
 */
async function resolveUnclaimed(
  args: IDiscoverFieldsArgs,
  accum: IFieldAccum,
  field: IFieldConfig,
): Promise<IResolvedTarget | false> {
  const resolved = await resolveOneField({ args, field, anchor: accum.formAnchor });
  return rejectClaimedTarget({ accum, field, resolved, logger: args.logger });
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
  const resolved = await resolveUnclaimed(args, accum, field);
  accumulateField({ accum, field, resolved, logger: args.logger });
  const formAnchor = await maybeDiscoverAnchor(args, { accum, field, resolved });
  return { targets: accum.targets, formAnchor };
}
