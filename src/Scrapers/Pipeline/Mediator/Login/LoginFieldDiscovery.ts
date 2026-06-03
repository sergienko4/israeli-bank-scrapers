/**
 * LOGIN field-discovery types + pure helpers.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./LoginPhaseActions.ts}.
 */

import type { Page } from 'playwright-core';

import type { IFieldConfig } from '../../../Base/Interfaces/Config/FieldConfig.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { none, type Option } from '../../Types/Option.js';
import {
  type ILoginFieldDiscovery,
  type IPipelineContext,
  type IResolvedTarget,
  type LoginFieldKey,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { computeContextId } from '../Elements/ActionExecutors.js';
import type { IFormAnchor } from '../Form/FormAnchor.js';
import { passwordFirst } from '../Form/LoginScopeResolver.js';
import type { IFieldContext } from '../Selector/SelectorResolverPipeline.js';
import type { IDiscoverFieldsArgs } from './LoginFieldDiscovery.types.js';
import { resolveSubmitTarget } from './LoginSubmitResolve.js';

/** Accumulator for field discovery reduce. */
interface IFieldAccum {
  readonly targets: Map<LoginFieldKey, IResolvedTarget>;
  readonly formAnchor: Option<IFormAnchor>;
}

/**
 * Assemble an {@link IResolvedTarget} from a resolved {@link IFieldContext}.
 * @param value - Successful field-resolver value.
 * @param page - Browser page (for frame-id derivation).
 * @param key - Original credential key recorded as `candidateValue`.
 * @returns Fully populated resolved target.
 */
function buildPreTarget(value: IFieldContext, page: Page, key: string): IResolvedTarget {
  return {
    selector: value.selector,
    contextId: computeContextId(value.context, page),
    kind: value.resolvedKind ?? value.resolvedVia,
    candidateValue: key,
  };
}

/**
 * Resolve one credential field and build an IResolvedTarget.
 * @param args - Discovery bundle.
 * @param field - Field config to resolve.
 * @returns Resolved target or false if not found.
 */
async function resolveOneField(
  args: IDiscoverFieldsArgs,
  field: IFieldConfig,
): Promise<IResolvedTarget | false> {
  const key = field.credentialKey;
  args.logger.debug({ message: `PRE resolving ${maskVisibleText(key)}` });
  const r = await args.mediator.resolveField(key, field.selectors, args.activeFrame);
  if (!r.success) return false;
  return buildPreTarget(r.value, args.page, key);
}

/** Lookup for field resolution trace labels. */
const FIELD_RESULT_TAG: Record<string, string> = { true: 'FOUND', false: 'NOT_FOUND' };

/** Bundle for {@link accumulateField} — under the 3-param ceiling. */
interface IAccumulateCallArgs {
  readonly accum: IFieldAccum;
  readonly field: IFieldConfig;
  readonly resolved: IResolvedTarget | false;
  readonly logger: IPipelineContext['logger'];
}

/**
 * Accumulate one resolved field into the targets map + emit trace log.
 * @param call - Bundled accumulate arguments.
 * @returns Always `true` so the call expression is a meaningful statement.
 */
function accumulateField(call: IAccumulateCallArgs): true {
  const key = call.field.credentialKey as LoginFieldKey;
  const tag = FIELD_RESULT_TAG[String(!!call.resolved)];
  call.logger.debug({ field: maskVisibleText(key), result: tag });
  if (call.resolved) call.accum.targets.set(key, call.resolved);
  return true;
}

/** Args bundle for {@link maybeDiscoverAnchor}. */
interface IAnchorCheckArgs {
  readonly accum: IFieldAccum;
  readonly field: IFieldConfig;
  readonly resolved: IResolvedTarget | false;
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
async function maybeDiscoverAnchor(
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
async function resolveAndAccumulate(
  args: IDiscoverFieldsArgs,
  accum: IFieldAccum,
  field: IFieldConfig,
): Promise<IFieldAccum> {
  const resolved = await resolveOneField(args, field);
  accumulateField({ accum, field, resolved, logger: args.logger });
  const formAnchor = await maybeDiscoverAnchor(args, { accum, field, resolved });
  return { targets: accum.targets, formAnchor };
}

/**
 * Build a single-step reducer that resolves one field on top of the
 * running accumulator promise.
 * @param args - Discovery bundle.
 * @returns Reducer accepted by {@link Array.reduce}.
 */
function makeFieldStep(
  args: IDiscoverFieldsArgs,
): (acc: Promise<IFieldAccum>, field: IFieldConfig) => Promise<IFieldAccum> {
  return (acc, field) => acc.then(a => resolveAndAccumulate(args, a, field));
}

/**
 * Fold the ordered field list into an {@link IFieldAccum} sequentially.
 * @param args - Discovery bundle.
 * @param ordered - Fields in password-first iteration order.
 * @returns Accumulator after every field has been processed.
 */
async function foldDiscoveryFields(
  args: IDiscoverFieldsArgs,
  ordered: readonly IFieldConfig[],
): Promise<IFieldAccum> {
  const seed: IFieldAccum = { targets: new Map(), formAnchor: none() };
  const initial: Promise<IFieldAccum> = Promise.resolve(seed);
  const step = makeFieldStep(args);
  return ordered.reduce((acc, field) => step(acc, field), initial);
}

/**
 * Select the active-frame id for downstream submit resolution.
 * @param args - Discovery bundle.
 * @param final - Final field-resolution accumulator.
 * @returns Frame id where the submit button must live.
 */
function pickActiveFrameId(args: IDiscoverFieldsArgs, final: IFieldAccum): string {
  const fallback = computeContextId(args.activeFrame, args.page);
  const passwordTarget = final.targets.get('password');
  return passwordTarget?.contextId ?? fallback;
}

/**
 * Discover all login fields via mediator and build ILoginFieldDiscovery.
 * @param args - Bundled discovery arguments.
 * @returns Fully populated login field discovery.
 */
async function executeDiscoverFields(args: IDiscoverFieldsArgs): Promise<ILoginFieldDiscovery> {
  const ordered = passwordFirst(args.config.fields);
  const final = await foldDiscoveryFields(args, ordered);
  const activeFrameId = pickActiveFrameId(args, final);
  const submitTarget = await resolveSubmitTarget(args, final.formAnchor, activeFrameId);
  return { targets: final.targets, formAnchor: final.formAnchor, activeFrameId, submitTarget };
}

export type { IDiscoverFieldsArgs };
export { executeDiscoverFields };
