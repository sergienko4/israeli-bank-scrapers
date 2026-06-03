/**
 * Per-strategy resolution: password / text-by-index handlers, plus
 * the dispatch table consumed by HeuristicResolver entry points.
 */

import type { Frame, Locator } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';
import { none, type Option, some } from '../../Types/Option.js';
import {
  buildIdSelector,
  emptyMatch,
  probeLocatorCount,
  probeLocatorEnabled,
  probeLocatorId,
  probeLocatorVisible,
} from './HeuristicResolver.probes.js';
import {
  type HeuristicStrategy,
  type ITextStrategy,
  PASSWORD_SELECTOR,
  TEXT_INPUT_SELECTOR,
} from './HeuristicResolver.types.js';
import type { IFieldMatch } from './SelectorResolverPipeline.js';

const LOG = getDebug(import.meta.url);

/**
 * Emit the password probe trace line.
 * @param isFound - Whether at least one password element was found.
 * @returns Sentinel `true` so the call can be expression-chained.
 */
function logPasswordTrace(isFound: boolean): true {
  const result = isFound ? 'FOUND' : 'NOT_FOUND';
  LOG.trace({ field: 'password', result });
  return true;
}

/**
 * Reachability probe: count + visibility for a password locator.
 * @param locator - First-match locator for `input[type="password"]`.
 * @returns True when the password input is present AND visible.
 */
async function isPasswordReachable(locator: Locator): Promise<boolean> {
  const count = await probeLocatorCount(locator);
  logPasswordTrace(count > 0);
  if (count === 0) return false;
  const isVis = await probeLocatorVisible(locator);
  LOG.trace({ message: `password visible=${String(isVis)}` });
  return isVis;
}

/**
 * Try to resolve a password field in the given frame.
 * @param frame - The iframe to search in.
 * @returns Field match with selector, or empty if not found.
 */
async function resolvePasswordInFrame(frame: Frame): Promise<IFieldMatch> {
  const locator = frame.locator(PASSWORD_SELECTOR).first();
  const isReachable = await isPasswordReachable(locator);
  if (!isReachable) return emptyMatch(frame);
  const elemId = await probeLocatorId(locator);
  const selector = buildIdSelector(PASSWORD_SELECTOR, elemId);
  LOG.trace({ field: 'password', result: 'FOUND' });
  return { selector, context: frame, kind: 'css' };
}

/**
 * Probe an index-based text input candidate for visibility + enablement.
 * @param all - Locator over all candidate text inputs.
 * @param index - Positional index inside `all`.
 * @returns Some(target) when reachable, none() otherwise.
 */
async function probeTextAtIndex(all: Locator, index: number): Promise<Option<Locator>> {
  const total = await probeLocatorCount(all);
  if (index >= total) return none();
  const target = all.nth(index);
  const isVis = await probeLocatorVisible(target);
  if (!isVis) return none();
  const isEnabled = await probeLocatorEnabled(target);
  if (!isEnabled) return none();
  return some(target);
}

/**
 * Build the field-match payload for a resolved text input.
 * @param target - Resolved playwright locator.
 * @param frame - Owning frame.
 * @param index - Positional index used for the fallback selector.
 * @returns Field-match payload with id-preferred selector.
 */
async function buildTextMatch(target: Locator, frame: Frame, index: number): Promise<IFieldMatch> {
  const elemId = await probeLocatorId(target);
  const fallback = `${TEXT_INPUT_SELECTOR} >> nth=${String(index)}`;
  const selector = buildIdSelector(fallback, elemId);
  return { selector, context: frame, kind: 'css' };
}

/**
 * Resolve a text-input target locator at the given index (visible+enabled).
 * @param frame - Owning frame.
 * @param index - 0-based index.
 * @returns Option carrying the playwright locator.
 */
async function findTextTarget(frame: Frame, index: number): Promise<Option<Locator>> {
  const all = frame.locator(TEXT_INPUT_SELECTOR);
  return probeTextAtIndex(all, index);
}

/**
 * Emit the FOUND log row and return the prepared match.
 * @param match - Resolved field match.
 * @param fieldKey - Credential key for logging.
 * @returns The same match (chaining convenience).
 */
function logTextFound(match: IFieldMatch, fieldKey: string): IFieldMatch {
  LOG.debug({ field: `heuristic:${fieldKey}`, result: 'FOUND' });
  return match;
}

/**
 * Try to resolve a text input field by positional index.
 * @param frame - The iframe to search in.
 * @param index - The 0-based index among visible text inputs.
 * @param fieldKey - Credential key for logging.
 * @returns Field match with selector, or empty if not found.
 */
async function resolveTextByIndex(
  frame: Frame,
  index: number,
  fieldKey: string,
): Promise<IFieldMatch> {
  const targetOpt = await findTextTarget(frame, index);
  if (!targetOpt.has) return emptyMatch(frame);
  const match = await buildTextMatch(targetOpt.value, frame, index);
  return logTextFound(match, fieldKey);
}

/** Handler signature for a single heuristic strategy variant. */
type StrategyHandler = (
  frame: Frame,
  fieldKey: string,
  strategy: HeuristicStrategy,
) => Promise<IFieldMatch>;

/**
 * Password-strategy dispatch — first `input[type="password"]`.
 * @param frame - Frame to probe.
 * @returns Field match (selector empty when not found).
 */
const DISPATCH_PASSWORD: StrategyHandler = async (frame): Promise<IFieldMatch> =>
  resolvePasswordInFrame(frame);

/**
 * Text-strategy dispatch — `index`-th visible/enabled text input.
 * @param frame - Frame to probe.
 * @param fieldKey - Credential key for logging.
 * @param strategy - Strategy carrying the positional index.
 * @returns Field match (selector empty when not found).
 */
const DISPATCH_TEXT: StrategyHandler = async (frame, fieldKey, strategy): Promise<IFieldMatch> => {
  const textStrategy = strategy as ITextStrategy;
  return resolveTextByIndex(frame, textStrategy.index, fieldKey);
};

/** Dispatch table mapping each strategy variant to its handler. */
const STRATEGY_HANDLERS: Record<HeuristicStrategy['type'], StrategyHandler> = {
  password: DISPATCH_PASSWORD,
  text: DISPATCH_TEXT,
};

export { STRATEGY_HANDLERS };
export type { StrategyHandler };
