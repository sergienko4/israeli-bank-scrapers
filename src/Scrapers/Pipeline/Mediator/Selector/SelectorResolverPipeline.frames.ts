/**
 * Iframe-search helpers for SelectorResolverPipeline.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { tryInContextInternal } from './SelectorResolver.js';
import { toFieldContext } from './SelectorResolverPipeline.context.js';
import type {
  IFieldContext,
  IFieldMatch,
  IResolveAllOpts,
} from './SelectorResolverPipeline.types.js';

const LOG = getDebug(import.meta.url);

/**
 * Try a single frame for matching candidates.
 * @param frame - The iframe to search in.
 * @param allCandidates - The candidates to try.
 * @returns A field match result (selector is empty string if not found).
 */
async function tryFrame(frame: Frame, allCandidates: SelectorCandidate[]): Promise<IFieldMatch> {
  const found = await tryInContextInternal(frame, allCandidates);
  if (!found.css) return { selector: '', context: frame };
  const frameUrl = frame.url();
  LOG.debug({ field: `iframe:${maskVisibleText(frameUrl)}`, result: 'FOUND' });
  return { selector: found.css, context: frame, kind: found.kind };
}

/**
 * Get child frames from a page, using cached frames if available.
 * @param page - The Playwright Page to get frames from.
 * @param cachedFrames - Optional pre-cached child frames.
 * @returns The list of child frames.
 */
function getChildFrames(page: Page, cachedFrames?: Frame[]): Frame[] {
  const mainFrame = page.mainFrame();
  return cachedFrames ?? page.frames().filter(f => f !== mainFrame);
}

/**
 * Reducer step: run the next action only when the prior step did not match.
 * @param prev - Prior accumulated match promise.
 * @param action - Action to run when prior is empty.
 * @returns Promise of the resolved match.
 */
async function reduceFrameStep(
  prev: Promise<IFieldMatch>,
  action: () => Promise<IFieldMatch>,
): Promise<IFieldMatch> {
  const result = await prev;
  if (result.selector) return result;
  return action();
}

/**
 * Reduce frame actions sequentially, returning first match.
 * @param actions - The frame probe actions to execute.
 * @param emptyMatch - The fallback empty match result.
 * @returns The first matching field, or the empty match.
 */
function reduceFrameActions(
  actions: (() => Promise<IFieldMatch>)[],
  emptyMatch: IFieldMatch,
): Promise<IFieldMatch> {
  const initialValue: Promise<IFieldMatch> = Promise.resolve(emptyMatch);
  return actions.reduce<Promise<IFieldMatch>>(reduceFrameStep, initialValue);
}

/**
 * Build per-frame action closures.
 * @param childFrames - Frames to probe.
 * @param allCandidates - Candidate list.
 * @returns Array of action closures.
 */
function buildFrameActions(
  childFrames: readonly Frame[],
  allCandidates: SelectorCandidate[],
): (() => Promise<IFieldMatch>)[] {
  return childFrames.map(frame => async (): Promise<IFieldMatch> => tryFrame(frame, allCandidates));
}

/**
 * Emit the per-round-1 debug log line when there are frames to search.
 * @param childFrames - Frames being searched.
 * @returns Sentinel `true` so the call can be expression-chained.
 */
function logRound1(childFrames: readonly Frame[]): true {
  if (childFrames.length > 0) {
    const count = String(childFrames.length);
    LOG.debug({ message: `Round 1: searching ${count} iframe(s)` });
  }
  return true;
}

/**
 * Search child iframes for a matching selector candidate.
 * @param page - The Playwright Page to search frames in.
 * @param allCandidates - The ordered list of selector candidates to try.
 * @param cachedFrames - Optional pre-cached child frames.
 * @returns A field match result (selector is empty string if not found).
 */
async function searchInChildFrames(
  page: Page,
  allCandidates: SelectorCandidate[],
  cachedFrames?: Frame[],
): Promise<IFieldMatch> {
  const childFrames = getChildFrames(page, cachedFrames);
  logRound1(childFrames);
  const actions = buildFrameActions(childFrames, allCandidates);
  return reduceFrameActions(actions, { selector: '', context: page });
}

/** Options for trying a candidate group in child frames. */
interface IIframeGroupOpts {
  /** Page being probed. */
  readonly page: Page;
  /** Candidate list. */
  readonly candidates: SelectorCandidate[];
  /** resolvedVia label for matches. */
  readonly via: IFieldContext['resolvedVia'];
  /** Optional pre-cached child frames. */
  readonly cachedFrames?: Frame[];
}

/**
 * Try a single candidate group in child frames.
 * @param opts - The iframe group options.
 * @returns A IFieldContext if found, or empty field match.
 */
async function tryIframeGroup(opts: IIframeGroupOpts): Promise<IFieldContext | IFieldMatch> {
  if (opts.candidates.length === 0) return { selector: '', context: opts.page };
  const result = await searchInChildFrames(opts.page, opts.candidates, opts.cachedFrames);
  if (result.selector) return toFieldContext(result, opts.via, 'iframe');
  return { selector: '', context: opts.page };
}

/** Bundled args for {@link probeBankIframeGroup}. */
interface IProbeBankArgs {
  /** The shared probe context (page + cached frames). */
  readonly base: { page: Page; cachedFrames?: Frame[] };
  /** The resolve options containing bank candidates. */
  readonly opts: IResolveAllOpts;
}

/**
 * Probe the bank-config candidate group inside child iframes.
 * @param args - Bundled base context + resolve options.
 * @returns A IFieldContext if found, or empty field match.
 */
async function probeBankIframeGroup(args: IProbeBankArgs): Promise<IFieldContext | IFieldMatch> {
  return tryIframeGroup({ ...args.base, candidates: args.opts.bankCandidates, via: 'bankConfig' });
}

/**
 * Probe all child iframes for a matching field.
 * @param page - The Playwright Page to search frames in.
 * @param opts - The resolve options containing candidates and cached frames.
 * @returns A IFieldContext if found in an iframe, or empty field match.
 */
async function probeIframes(
  page: Page,
  opts: IResolveAllOpts,
): Promise<IFieldContext | IFieldMatch> {
  const base = { page, cachedFrames: opts.cachedFrames };
  const bankResult = await probeBankIframeGroup({ base, opts });
  if ('isResolved' in bankResult) return bankResult;
  return tryIframeGroup({ ...base, candidates: opts.wellKnownCandidates, via: 'wellKnown' });
}

export { probeIframes, searchInChildFrames };
