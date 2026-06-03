/**
 * Candidate probing: per-kind dispatch, fillable checks, and the
 * `tryInContextInternal` reducer over a candidate list.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { RACE_TIMED_OUT, raceTimeout } from '../Timing/Waiting.js';
import {
  isClickableElement,
  isFillableInput,
  resolveLabelText,
  resolveTextContent,
} from './SelectorLabelStrategies.js';
import {
  debugCandidateSkipped,
  logProbeNotFillable,
  logProbeNotFound,
  logProbeOutcome,
} from './SelectorResolver.probe.log.js';
import type { IProbeResult } from './SelectorResolver.types.js';
import { buildTextXpath, candidateToCss } from './SelectorResolver.xpath.js';
import { CANDIDATE_TIMEOUT_MS } from './SelectorResolverConfig.js';

const LOG = getDebug(import.meta.url);

type Ctx = Page | Frame;
type ProbeFn = (ctx: Ctx, c: SelectorCandidate) => Promise<IProbeResult>;

/**
 * Query for an element with a timeout to avoid hanging on detached frames.
 * @param ctx - The Page or Frame context to query in.
 * @param css - The CSS or XPath selector to look for.
 * @returns Whether the element was found within the timeout.
 */
async function queryWithTimeout(ctx: Ctx, css: string): Promise<boolean> {
  const queryPromise = ctx.$(css);
  const el = await raceTimeout(CANDIDATE_TIMEOUT_MS, queryPromise);
  return el !== RACE_TIMED_OUT && el !== null;
}

/**
 * Probe a labelText candidate in the given context.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The labelText selector candidate to probe.
 * @returns The probe result with css and kind, or empty result if not found.
 */
async function probeLabelText(ctx: Ctx, candidate: SelectorCandidate): Promise<IProbeResult> {
  const css = candidateToCss(candidate);
  const resolved = await resolveLabelText({
    ctx,
    labelXpath: css,
    labelValue: candidate.value,
    queryFn: queryWithTimeout,
  });
  return { css: resolved, kind: 'labelText' };
}

/**
 * Probe a textContent candidate: find visible text, walk up DOM to interactive ancestor.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The textContent selector candidate to probe.
 * @returns The probe result with css and kind, or empty result if not found.
 */
async function probeTextContent(ctx: Ctx, candidate: SelectorCandidate): Promise<IProbeResult> {
  const resolved = await resolveTextContent(ctx, candidate.value, queryWithTimeout);
  return { css: resolved, kind: 'textContent' };
}

/** Candidate kinds that target input fields — must pass isFillableInput check. */
const FILLABLE_KINDS = new Set(['name', 'ariaLabel']);

/**
 * Check if a found candidate is fillable (for input-targeting kinds only).
 * @param ctx - Page or Frame context.
 * @param css - Resolved CSS selector.
 * @param kind - Candidate kind.
 * @returns True if fillable or not an input-targeting kind.
 */
async function checkFillable(ctx: Ctx, css: string, kind: string): Promise<boolean> {
  if (!FILLABLE_KINDS.has(kind)) return true;
  return isFillableInput(ctx, css).catch((): boolean => true);
}

/**
 * Resolve the final probe outcome for a found-and-fillable candidate.
 * @param css - Resolved CSS selector.
 * @param candidate - Selector candidate that matched.
 * @returns The probe result with the candidate's kind.
 */
function probeFound(css: string, candidate: SelectorCandidate): IProbeResult {
  logProbeOutcome(candidate, 'FOUND');
  return { css, kind: candidate.kind };
}

/**
 * Probe a standard (non-label, non-textContent) candidate via direct query.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The selector candidate to probe.
 * @returns The probe result with css and kind, or empty result if not found.
 */
async function probeStandard(ctx: Ctx, candidate: SelectorCandidate): Promise<IProbeResult> {
  const css = candidateToCss(candidate);
  const isFound = await queryWithTimeout(ctx, css);
  if (!isFound) return logProbeNotFound(candidate);
  const isFillable = await checkFillable(ctx, css, candidate.kind);
  if (!isFillable) return logProbeNotFillable(candidate);
  return probeFound(css, candidate);
}

/**
 * Probe for clickable element matching visible text.
 * @param ctx - Playwright Page or Frame.
 * @param candidate - Selector candidate with text value.
 * @returns Probe result with resolved XPath or empty css.
 */
async function probeClickableText(ctx: Ctx, candidate: SelectorCandidate): Promise<IProbeResult> {
  const xpath = buildTextXpath(candidate.value);
  const isFound = await queryWithTimeout(ctx, xpath);
  if (!isFound) return { css: '', kind: 'clickableText' };
  const hasClick = await isClickableElement(ctx, xpath).catch((): boolean => true);
  if (!hasClick) return { css: '', kind: 'clickableText' };
  LOG.debug({ field: `clickableText:${maskVisibleText(candidate.value)}`, result: 'FOUND' });
  return { css: xpath, kind: 'clickableText' };
}

/** Map from candidate kind to a specialized probe function. */
const PROBE_DISPATCH: Partial<Record<SelectorCandidate['kind'], ProbeFn>> = {
  labelText: probeLabelText,
  textContent: probeTextContent,
  clickableText: probeClickableText,
};

/**
 * Dispatch to the appropriate probe function based on candidate kind.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The selector candidate to probe.
 * @returns The probe result with css and kind.
 */
async function dispatchProbe(ctx: Ctx, candidate: SelectorCandidate): Promise<IProbeResult> {
  const specialized = PROBE_DISPATCH[candidate.kind];
  if (specialized) return specialized(ctx, candidate);
  return probeStandard(ctx, candidate);
}

/**
 * Probe a single candidate in the given context.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The selector candidate to probe.
 * @returns The probe result with css and kind, or empty result if not found.
 */
async function probeCandidate(ctx: Ctx, candidate: SelectorCandidate): Promise<IProbeResult> {
  return dispatchProbe(ctx, candidate).catch((): IProbeResult => {
    debugCandidateSkipped(candidate);
    return { css: '', kind: candidate.kind };
  });
}

export { probeCandidate, queryWithTimeout };
