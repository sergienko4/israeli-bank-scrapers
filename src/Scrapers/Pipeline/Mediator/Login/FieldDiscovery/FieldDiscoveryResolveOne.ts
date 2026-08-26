/**
 * Single-field resolver helpers for LoginFieldDiscovery.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginFieldDiscovery.ts}.
 */

import type { Page } from 'playwright-core';

import { maskVisibleText } from '../../../Types/LogEvent.js';
import type { Option } from '../../../Types/Option.js';
import type { IResolvedTarget } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { computeContextId } from '../../Elements/ActionExecutors.js';
import { readElementIdentity } from '../../Elements/ElementIdentity.js';
import type { IFormAnchor } from '../../Form/FormAnchor.js';
import type { IFieldContext } from '../../Selector/SelectorResolverPipeline.js';
import type { IDiscoverFieldsArgs } from '../LoginFieldDiscovery.types.js';
import type { IResolveOneArgs } from './FieldDiscoveryTypes.js';

/**
 * Assemble the selector-derived part of a resolved target.
 * @param value - Successful field-resolver value.
 * @param page - Browser page (for frame-id derivation).
 * @param key - Original credential key recorded as `candidateValue`.
 * @returns Resolved target without an identity token.
 */
function buildTargetBase(value: IFieldContext, page: Page, key: string): IResolvedTarget {
  return {
    selector: value.selector,
    contextId: computeContextId(value.context, page),
    kind: value.resolvedKind ?? value.resolvedVia,
    candidateValue: key,
  };
}

/**
 * Assemble an {@link IResolvedTarget} from a resolved {@link IFieldContext}.
 *
 * <p>Reads the element's position token while the resolution is still fresh,
 * so the collision guard can later compare identity instead of selector text.
 * @param value - Successful field-resolver value.
 * @param page - Browser page (for frame-id derivation).
 * @param key - Original credential key recorded as `candidateValue`.
 * @returns Fully populated resolved target.
 */
export async function buildPreTarget(
  value: IFieldContext,
  page: Page,
  key: string,
): Promise<IResolvedTarget> {
  const base = buildTargetBase(value, page, key);
  const elementId = await readElementIdentity(value.context, value.selector);
  return { ...base, elementId };
}

/**
 * Pull the discovered form-anchor selector — empty string when no
 * anchor has been captured yet.
 * @param anchor - Option wrapping the previously discovered anchor.
 * @returns Anchor's CSS selector, or '' when no anchor exists.
 */
function pickFormSelector(anchor: Option<IFormAnchor>): string {
  return anchor.has ? anchor.value.selector : '';
}

/**
 * Map a field-resolution procedure into the {@link IResolvedTarget} or
 * the `false` sentinel used by the discovery accumulator.
 * @param r - Field resolver outcome.
 * @param args - Discovery bundle (for page/logger context).
 * @param key - Credential key being resolved.
 * @returns Resolved target on success, `false` otherwise.
 */
export async function preTargetOrFalse(
  r: Procedure<IFieldContext>,
  args: IDiscoverFieldsArgs,
  key: string,
): Promise<IResolvedTarget | false> {
  if (!r.success) return false;
  return buildPreTarget(r.value, args.page, key);
}

/**
 * Resolve one credential field and build an IResolvedTarget. Once the
 * accumulator has captured a form anchor (after the first successful
 * field resolution), every subsequent `resolveField` call is scoped
 * INSIDE that anchor (issue #307).
 * @param call - Bundled resolve arguments.
 * @returns Resolved target or false if not found.
 */
export async function resolveOneField(call: IResolveOneArgs): Promise<IResolvedTarget | false> {
  const { args, field, anchor } = call;
  const key = field.credentialKey;
  args.logger.debug({ message: `PRE resolving ${maskVisibleText(key)}` });
  const scope = pickFormSelector(anchor);
  const r = await args.mediator.resolveField(key, field.selectors, args.activeFrame, scope);
  return preTargetOrFalse(r, args, key);
}
