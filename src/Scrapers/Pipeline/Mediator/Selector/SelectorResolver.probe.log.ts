/**
 * Diagnostic loggers for candidate-probe outcomes.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IProbeResult } from './SelectorResolver.types.js';

const LOG = getDebug(import.meta.url);

/**
 * Log that a candidate was skipped due to cross-origin or detached frame.
 * @param candidate - The selector candidate that was skipped.
 * @returns True after logging completes.
 */
function debugCandidateSkipped(candidate: SelectorCandidate): boolean {
  LOG.debug({
    message: `candidate ${candidate.kind}` + ` "${maskVisibleText(candidate.value)}" → skipped`,
  });
  return true;
}

/**
 * Emit a found/not-found diagnostic for a probe outcome.
 * @param candidate - Selector candidate being probed.
 * @param result - Probe outcome.
 * @returns Sentinel `true` so the call can be expression-chained.
 */
function logProbeOutcome(candidate: SelectorCandidate, result: 'FOUND' | 'NOT_FOUND'): true {
  LOG.debug({ field: `${candidate.kind}:${maskVisibleText(candidate.value)}`, result });
  return true;
}

/**
 * Build the standard "empty miss" probe result for a candidate kind.
 * @param candidate - Selector candidate whose kind seeds the result.
 * @returns Empty IProbeResult with the candidate's kind.
 */
function emptyProbeFor(candidate: SelectorCandidate): IProbeResult {
  return { css: '', kind: candidate.kind };
}

/**
 * Emit "candidate NOT FILLABLE" diagnostic and return empty result.
 * @param candidate - Selector candidate that failed the fillable check.
 * @returns Empty probe result with the candidate's kind.
 */
function logProbeNotFillable(candidate: SelectorCandidate): IProbeResult {
  const masked = maskVisibleText(candidate.value);
  LOG.debug({ message: `candidate ${candidate.kind} "${masked}" → NOT FILLABLE` });
  return emptyProbeFor(candidate);
}

/**
 * Emit NOT_FOUND diagnostic and return the standard empty probe result.
 * @param candidate - Selector candidate that missed.
 * @returns Empty probe result with the candidate's kind.
 */
function logProbeNotFound(candidate: SelectorCandidate): IProbeResult {
  logProbeOutcome(candidate, 'NOT_FOUND');
  return emptyProbeFor(candidate);
}

export {
  debugCandidateSkipped,
  emptyProbeFor,
  logProbeNotFillable,
  logProbeNotFound,
  logProbeOutcome,
};
