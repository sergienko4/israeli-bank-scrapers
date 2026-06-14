/**
 * Frame-match telemetry + result-bundle helpers for the submit race.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginSubmitResolve.ts}.
 */

import { none, type Option, some } from '../../../Types/Option.js';
import type { IResolvedTarget } from '../../../Types/PipelineContext.js';
import type { IRaceResult } from '../../Elements/ElementMediator.js';
import { extractCandidateKind, extractCandidateVal } from '../LoginFormAnchor.js';
import type { IFrameMatchArgs, IResolveInFrameArgs } from './SubmitResolveTypes.js';

/**
 * Build the non-contextId fields of a frame-match bundle.
 * @param input - Resolve-in-frame args.
 * @param result - Race result from `mediator.resolveVisible`.
 * @returns Omit<bundle, 'contextId'>.
 */
export function frameMatchExtras(
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
export function buildFrameMatchArgs(
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
export function logFrameMismatch(matchArgs: IFrameMatchArgs): Option<IResolvedTarget> {
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
export function logFrameMatch(matchArgs: IFrameMatchArgs): true {
  matchArgs.logger.debug({
    field: 'submit',
    result: 'FOUND',
    message: `"${matchArgs.candidateVal}" kind=${matchArgs.kind} frame=${matchArgs.contextId}`,
  });
  return true;
}

/**
 * Build the success Option for a frame-matched race.
 * @param matchArgs - Frame-match bundle.
 * @param selector - Final click selector.
 * @returns `some(target)` populated from the bundle.
 */
export function buildSuccessTarget(
  matchArgs: IFrameMatchArgs,
  selector: string,
): Option<IResolvedTarget> {
  const { contextId, kind, candidateVal: candidateValue } = matchArgs;
  return some({ selector, contextId, kind, candidateValue });
}
