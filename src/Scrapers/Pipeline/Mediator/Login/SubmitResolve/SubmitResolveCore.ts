/**
 * Core race + try-helpers for the LoginSubmitResolve race cluster.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginSubmitResolve.ts}.
 */

import { none, type Option } from '../../../Types/Option.js';
import type { IResolvedTarget } from '../../../Types/PipelineContext.js';
import { computeContextId } from '../../Elements/ActionExecutors.js';
import type { IRaceResult } from '../../Elements/ElementMediator.js';
import type { IDiscoverFieldsArgs } from '../LoginFieldDiscovery.types.js';
import { buildSubmitSelector, normalizeSubmitConfig } from '../LoginFormAnchor.js';
import { buildResolveArgs } from './SubmitResolveBuild.js';
import {
  buildFrameMatchArgs,
  buildSuccessTarget,
  logFrameMatch,
  logFrameMismatch,
} from './SubmitResolveFrameMatch.js';
import {
  type IFrameScope,
  type IResolveInFrameArgs,
  STRUCTURAL_SUBMIT_WK,
} from './SubmitResolveTypes.js';

/**
 * Bridge to `mediator.resolveVisible` with the resolve-in-frame bundle.
 * @param input - Resolve-in-frame args bundle.
 * @returns Race result from the mediator.
 */
export async function resolveVisibleCandidates(input: IResolveInFrameArgs): Promise<IRaceResult> {
  return input.args.mediator.resolveVisible(input.candidates, undefined, input.formAnchor);
}

/**
 * Resolve a visible element strictly within a specific frame.
 * @param input - Bundled args + candidates + frame + formAnchor.
 * @returns Resolved target in the correct frame, or none.
 */
export async function resolveInFrame(input: IResolveInFrameArgs): Promise<Option<IResolvedTarget>> {
  const result = await resolveVisibleCandidates(input);
  if (!result.found || !result.context) return none();
  const contextId = computeContextId(result.context, input.args.page);
  const matchArgs = buildFrameMatchArgs(input, result, contextId);
  if (contextId !== matchArgs.requiredFrameId) return logFrameMismatch(matchArgs);
  logFrameMatch(matchArgs);
  const selector = buildSubmitSelector(result, input.formAnchor);
  return buildSuccessTarget(matchArgs, selector);
}

/**
 * Try the WK structural submit candidates in the password frame.
 * @param args - Discovery bundle.
 * @param scope - Frame scope (frame id + anchor selector).
 * @returns Option wrapping the structurally matched submit target.
 */
export async function tryStructuralSubmit(
  args: IDiscoverFieldsArgs,
  scope: IFrameScope,
): Promise<Option<IResolvedTarget>> {
  const resolveArgs = buildResolveArgs(args, STRUCTURAL_SUBMIT_WK, scope);
  return resolveInFrame(resolveArgs);
}

/**
 * Try the bank-configured submit candidates in the password frame.
 * @param args - Discovery bundle.
 * @param scope - Frame scope (frame id + anchor selector).
 * @returns Option wrapping the configured submit target.
 */
export async function tryConfiguredSubmit(
  args: IDiscoverFieldsArgs,
  scope: IFrameScope,
): Promise<Option<IResolvedTarget>> {
  const raw = normalizeSubmitConfig(args.config.submit);
  const resolveArgs = buildResolveArgs(args, raw, scope);
  return resolveInFrame(resolveArgs);
}
