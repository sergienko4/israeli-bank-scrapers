/**
 * LOGIN submit-target resolution — race-based search scoped to the
 * password frame + form anchor.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./LoginPhaseActions.ts}.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_LOGIN_FORM } from '../../Registry/WK/LoginWK.js';
import { none, type Option, some } from '../../Types/Option.js';
import { type IPipelineContext, type IResolvedTarget } from '../../Types/PipelineContext.js';
import { computeContextId } from '../Elements/ActionExecutors.js';
import type { IRaceResult } from '../Elements/ElementMediator.js';
import type { IFormAnchor } from '../Form/FormAnchor.js';
import type { IDiscoverFieldsArgs } from './LoginFieldDiscovery.types.js';
import {
  buildSubmitSelector,
  extractCandidateKind,
  extractCandidateVal,
  extractFormAnchorSelector,
  normalizeSubmitConfig,
} from './LoginFormAnchor.js';

/** Bundled args for resolveInFrame — under the 3-param ceiling. */
interface IResolveInFrameArgs {
  readonly args: IDiscoverFieldsArgs;
  readonly candidates: readonly SelectorCandidate[];
  readonly requiredFrameId: string;
  readonly formAnchor: string;
}

/** Bundled state captured once per submit-resolution race. */
interface IFrameMatchArgs {
  readonly logger: IPipelineContext['logger'];
  readonly candidateVal: string;
  readonly contextId: string;
  readonly kind: string;
  readonly requiredFrameId: string;
}

/**
 * Build the non-contextId fields of a frame-match bundle.
 * @param input - Resolve-in-frame args.
 * @param result - Race result from `mediator.resolveVisible`.
 * @returns Omit<bundle, 'contextId'>.
 */
function frameMatchExtras(
  input: IResolveInFrameArgs,
  result: IRaceResult,
): Omit<IFrameMatchArgs, 'contextId'> {
  const candidateVal = extractCandidateVal(result);
  const kind = extractCandidateKind(result);
  const { requiredFrameId } = input;
  return { logger: input.args.logger, candidateVal, kind, requiredFrameId };
}

/**
 * Build the bundled match metadata captured once per submit-resolution race.
 * @param input - Resolve-in-frame args.
 * @param result - Race result.
 * @param contextId - Frame id of the matched element.
 * @returns Frame-match bundle.
 */
function buildFrameMatchArgs(
  input: IResolveInFrameArgs,
  result: IRaceResult,
  contextId: string,
): IFrameMatchArgs {
  return { ...frameMatchExtras(input, result), contextId };
}

/**
 * Log a wrong-frame submit-resolution outcome and return `none()`.
 * @param matchArgs - Frame-match bundle.
 * @returns Always `none()`.
 */
function logFrameMismatch(matchArgs: IFrameMatchArgs): Option<IResolvedTarget> {
  const { candidateVal, contextId, requiredFrameId, logger } = matchArgs;
  const message = `"${candidateVal}" in ${contextId}, expected ${requiredFrameId}`;
  logger.debug({ field: 'submit', result: 'WRONG_FRAME', message });
  return none();
}

/**
 * Log a matched submit-resolution outcome.
 * @param matchArgs - Frame-match bundle.
 * @returns Always `true`.
 */
function logFrameMatch(matchArgs: IFrameMatchArgs): true {
  matchArgs.logger.debug({
    field: 'submit',
    result: 'FOUND',
    message: `"${matchArgs.candidateVal}" kind=${matchArgs.kind} frame=${matchArgs.contextId}`,
  });
  return true;
}

/**
 * Bridge to `mediator.resolveVisible` with the resolve-in-frame bundle.
 * @param input - Resolve-in-frame args bundle.
 * @returns Race result from the mediator.
 */
async function resolveVisibleCandidates(input: IResolveInFrameArgs): Promise<IRaceResult> {
  return input.args.mediator.resolveVisible(input.candidates, undefined, input.formAnchor);
}

/**
 * Build the success Option for a frame-matched race.
 * @param matchArgs - Frame-match bundle.
 * @param selector - Final click selector.
 * @returns `some(target)` populated from the bundle.
 */
function buildSuccessTarget(matchArgs: IFrameMatchArgs, selector: string): Option<IResolvedTarget> {
  return some({
    selector,
    contextId: matchArgs.contextId,
    kind: matchArgs.kind,
    candidateValue: matchArgs.candidateVal,
  });
}

/**
 * Resolve a visible element strictly within a specific frame.
 * @param input - Bundled args + candidates + frame + formAnchor.
 * @returns Resolved target in the correct frame, or none.
 */
async function resolveInFrame(input: IResolveInFrameArgs): Promise<Option<IResolvedTarget>> {
  const result = await resolveVisibleCandidates(input);
  if (!result.found || !result.context) return none();
  const contextId = computeContextId(result.context, input.args.page);
  const matchArgs = buildFrameMatchArgs(input, result, contextId);
  if (contextId !== matchArgs.requiredFrameId) return logFrameMismatch(matchArgs);
  logFrameMatch(matchArgs);
  const selector = buildSubmitSelector(result, input.formAnchor);
  return buildSuccessTarget(matchArgs, selector);
}

/** WK structural submit candidates. */
const STRUCTURAL_SUBMIT_WK =
  WK_LOGIN_FORM.submitStructural as unknown as readonly SelectorCandidate[];

/** Frame scope bundle (frame id + form anchor selector). */
interface IFrameScope {
  readonly frameId: string;
  readonly anchor: string;
}

/**
 * Build a resolve-in-frame args bundle for the given candidate list.
 * @param args - Discovery bundle.
 * @param candidates - Candidate list to race.
 * @param scope - Frame scope (frame id + anchor selector).
 * @returns Resolve-in-frame args bundle.
 */
function buildResolveArgs(
  args: IDiscoverFieldsArgs,
  candidates: readonly SelectorCandidate[],
  scope: IFrameScope,
): IResolveInFrameArgs {
  return { args, candidates, requiredFrameId: scope.frameId, formAnchor: scope.anchor };
}

/**
 * Try the WK structural submit candidates in the password frame.
 * @param args - Discovery bundle.
 * @param scope - Frame scope (frame id + anchor selector).
 * @returns Option wrapping the structurally matched submit target.
 */
async function tryStructuralSubmit(
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
async function tryConfiguredSubmit(
  args: IDiscoverFieldsArgs,
  scope: IFrameScope,
): Promise<Option<IResolvedTarget>> {
  const raw = normalizeSubmitConfig(args.config.submit);
  const resolveArgs = buildResolveArgs(args, raw, scope);
  return resolveInFrame(resolveArgs);
}

/**
 * Build the IFrameScope bundle from a form anchor + active frame id.
 * @param formAnchor - Discovered form anchor.
 * @param activeFrameId - Frame where password was found.
 * @returns Frame scope bundle.
 */
function buildScope(formAnchor: Option<IFormAnchor>, activeFrameId: string): IFrameScope {
  const anchor = extractFormAnchorSelector(formAnchor);
  return { frameId: activeFrameId, anchor };
}

/**
 * Resolve the submit button — ONE form, ONE button.
 * @param args - Discovery bundle.
 * @param formAnchor - Discovered form anchor.
 * @param activeFrameId - Frame where password was found.
 * @returns Option wrapping the resolved submit target.
 */
async function resolveSubmitTarget(
  args: IDiscoverFieldsArgs,
  formAnchor: Option<IFormAnchor>,
  activeFrameId: string,
): Promise<Option<IResolvedTarget>> {
  const scope = buildScope(formAnchor, activeFrameId);
  const structural = await tryStructuralSubmit(args, scope);
  if (structural.has) return structural;
  return tryConfiguredSubmit(args, scope);
}

export default resolveSubmitTarget;
export { resolveSubmitTarget };
