/**
 * Probe orchestration: iframes → main page → heuristic fallback.
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';
import { none, type Option, some } from '../../Types/Option.js';
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
 * Run the resolution pipeline: iframes first, then main page,
 * then heuristic fallback.
 * @param pageOrFrame - Page or Frame to search in.
 * @param opts - Pre-built resolve options.
 * @returns Resolved IFieldContext (may have isResolved=false on failure).
 */
async function probeAll(pageOrFrame: Page | Frame, opts: IResolveAllOpts): Promise<IFieldContext> {
  const hot = await tryHotPath(pageOrFrame, opts);
  if (hot.has) return hot.value;
  LOG.trace({ field: opts.field.credentialKey, result: 'NOT_FOUND' });
  const heuristic = await tryHeuristicProbe(pageOrFrame, opts.field.credentialKey);
  if (heuristic) return heuristic;
  return logAndBuildNotFound(opts);
}

export default probeAll;

export { probeAll };
