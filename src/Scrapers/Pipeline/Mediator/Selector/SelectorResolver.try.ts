/**
 * Reducer over the candidate list — `tryInContextInternal` and `tryInContext`.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { probeCandidate } from './SelectorResolver.probe.js';
import type { IProbeResult } from './SelectorResolver.types.js';

/** Empty probe result — no candidate matched. */
const EMPTY_PROBE: IProbeResult = { css: '', kind: 'css' };

/**
 * Build lazy probe actions for each candidate.
 * @param ctx - The Page or Frame context to query in.
 * @param candidates - The ordered list of selector candidates.
 * @returns Array of lazy probe action factories.
 */
function buildProbeActions(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
): (() => Promise<IProbeResult>)[] {
  return candidates.map(
    (candidate): (() => Promise<IProbeResult>) =>
      (): Promise<IProbeResult> =>
        probeCandidate(ctx, candidate),
  );
}

/**
 * Reducer step: skip future probes once the prior one matched.
 * @param prev - Prior accumulated probe promise.
 * @param action - Action to run when prior is empty.
 * @returns Promise of the resolved probe result.
 */
async function reduceProbeStep(
  prev: Promise<IProbeResult>,
  action: () => Promise<IProbeResult>,
): Promise<IProbeResult> {
  const result = await prev;
  if (result.css) return result;
  return action();
}

/**
 * Reduce probe actions sequentially, returning the first match.
 * @param actions - The lazy probe action factories.
 * @returns The first matching probe result, or empty result.
 */
function reduceProbeActions(actions: (() => Promise<IProbeResult>)[]): Promise<IProbeResult> {
  const seed = Promise.resolve(EMPTY_PROBE);
  return actions.reduce<Promise<IProbeResult>>(reduceProbeStep, seed);
}

/**
 * Internal: try each candidate, return first match with kind metadata.
 * @param ctx - The Page or Frame context to query in.
 * @param candidates - The ordered list of selector candidates to try.
 * @returns The first matching probe result, or empty result if none matched.
 */
async function tryInContextInternal(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
): Promise<IProbeResult> {
  const actions = buildProbeActions(ctx, candidates);
  return reduceProbeActions(actions);
}

/**
 * Try each candidate on `ctx` with a per-candidate timeout.
 * @param ctx - The Page or Frame context to query in.
 * @param candidates - The ordered list of selector candidates to try.
 * @returns The first matching CSS selector string, or empty string if none matched.
 */
async function tryInContext(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
): Promise<string> {
  const result = await tryInContextInternal(ctx, candidates);
  return result.css || '';
}

export { tryInContext, tryInContextInternal };
