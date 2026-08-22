/**
 * Probe orchestration: iframes → main page → heuristic fallback.
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';
import { none, type Option, some } from '../../Types/Option.js';
import { LOGIN_FIELD_RERESOLVE_WAIT } from '../Timing/LoginTimingConfig.js';
import { waitUntil } from '../Timing/Waiting.js';
import { tryHeuristicProbe } from './HeuristicResolver.js';
import { isPage } from './SelectorResolver.js';
import {
  buildNotFoundContext,
  type IFieldContext,
  type IResolveAllOpts,
  probeIframes,
  probeMainPage,
} from './SelectorResolverPipeline.js';

const LOG = getDebug(import.meta.url);

/** Outcome of one hot-path pass — kept aliased so signatures stay single-line. */
type HotPathResult = Promise<Option<IFieldContext>>;

/** Flattened hot-path outcome the poller can test for truthiness. */
type HotPathHit = Promise<IFieldContext | undefined>;

/**
 * Sentinel for an exhausted poll window.
 * @returns Always undefined.
 */
const NO_HIT = (): undefined => undefined;

/**
 * Try iframe resolution first (only for Page, not Frame).
 * @param pageOrFrame - Page or Frame.
 * @param opts - Resolve options.
 * @returns Resolved context from iframe, or Option.none if not found.
 */
async function tryIframeProbe(
  pageOrFrame: Page | Frame,
  opts: IResolveAllOpts,
): Promise<Option<IFieldContext>> {
  if (!isPage(pageOrFrame)) return none();
  const result = await probeIframes(pageOrFrame, opts);
  if ('isResolved' in result) return some(result);
  return none();
}

/**
 * Log a not-found diagnostic and build the final not-found context.
 * @param opts - Resolve options containing field details.
 * @returns Not-resolved IFieldContext with diagnostic message.
 */
async function logAndBuildNotFound(opts: IResolveAllOpts): Promise<IFieldContext> {
  LOG.debug({ field: opts.field.credentialKey, result: 'NOT_FOUND' });
  return buildNotFoundContext(opts);
}

/**
 * Hot-path probe: iframes first, then main page.
 * @param pageOrFrame - Page or Frame to search in.
 * @param opts - Resolve options.
 * @returns Some(context) on hit, none() on miss.
 */
async function tryHotPath(
  pageOrFrame: Page | Frame,
  opts: IResolveAllOpts,
): Promise<Option<IFieldContext>> {
  const iframeResult = await tryIframeProbe(pageOrFrame, opts);
  if (iframeResult.has) return iframeResult;
  const mainResult = await probeMainPage(opts);
  if ('isResolved' in mainResult) return some(mainResult);
  return none();
}

/**
 * One hot-path pass, flattened so the poller can test for a hit.
 * @param page - Page or Frame to search in.
 * @param opts - Resolve options.
 * @returns The resolved context, or undefined on a miss.
 */
async function pollHotPath(page: Page | Frame, opts: IResolveAllOpts): HotPathHit {
  const hot = await tryHotPath(page, opts);
  return hot.has ? hot.value : undefined;
}

/**
 * Poll the hot path until the field's own anchor renders.
 *
 * <p>A bank that reveals its second credential input only once the first
 * has rendered (Yahav discloses `תעודת זהות` after `קוד משתמש`) would
 * otherwise hand a still-absent field to the positional heuristic, which
 * then claims an input a neighbouring field already owns. Polling on the
 * anchor — rather than pausing blindly — costs nothing when the field is
 * already present and stops as soon as it appears.
 * @param page - Page or Frame to search in.
 * @param opts - Resolve options.
 * @returns Some(context) once the anchor renders, none() when it never does.
 */
async function waitForHotPath(page: Page | Frame, opts: IResolveAllOpts): HotPathResult {
  const probe = pollHotPath.bind(null, page, opts);
  const found = await waitUntil(probe, 'login field', LOGIN_FIELD_RERESOLVE_WAIT).catch(NO_HIT);
  return found === undefined ? none() : some(found);
}

/**
 * Run the resolution pipeline: iframes first, then main page, then a
 * bounded wait on the field's anchor, and only then the heuristic.
 * @param pageOrFrame - Page or Frame to search in.
 * @param opts - Pre-built resolve options.
 * @returns Resolved IFieldContext (may have isResolved=false on failure).
 */
async function probeAll(pageOrFrame: Page | Frame, opts: IResolveAllOpts): Promise<IFieldContext> {
  const hot = await tryHotPath(pageOrFrame, opts);
  if (hot.has) return hot.value;
  const waited = await waitForHotPath(pageOrFrame, opts);
  if (waited.has) return waited.value;
  LOG.trace({ field: opts.field.credentialKey, result: 'NOT_FOUND' });
  const heuristic = await tryHeuristicProbe(pageOrFrame, opts.field.credentialKey);
  if (heuristic) return heuristic;
  return logAndBuildNotFound(opts);
}

export default probeAll;

export { probeAll };
