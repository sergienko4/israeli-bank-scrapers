/**
 * HeuristicResolver — Round 3 fallback for bare-iframe login fields.
 * When WK text/label/placeholder/name all fail, detects inputs by type:
 *   password → input[type="password"]
 *   id       → first visible non-password, non-hidden input
 *   num      → second visible non-password, non-hidden input
 *
 * Cross-validates: isVisible() + isEnabled() before claiming success.
 * Only fires when Round 1 (iframe) and Round 2 (main page) both return empty.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { none, type Option, some } from '../../Types/Option.js';
import { isPage } from './SelectorResolver.js';
import type { IFieldContext, IFieldMatch } from './SelectorResolverPipeline.js';

const LOG = getDebug(import.meta.url);

/** Strategy for resolving a password-type field. */
interface IPasswordStrategy {
  readonly type: 'password';
}

/** Strategy for resolving a text-type field by positional index. */
interface ITextStrategy {
  readonly type: 'text';
  readonly index: number;
}

/** Union of heuristic resolution strategies. */
type HeuristicStrategy = IPasswordStrategy | ITextStrategy;

/** Map credential keys to their heuristic resolution strategy. */
const HEURISTIC_MAP: Readonly<Partial<Record<string, HeuristicStrategy>>> = {
  password: { type: 'password' },
  id: { type: 'text', index: 0 },
  username: { type: 'text', index: 0 },
  nationalID: { type: 'text', index: 0 },
  userCode: { type: 'text', index: 0 },
  num: { type: 'text', index: 1 },
  card6Digits: { type: 'text', index: 2 },
};

/** CSS selector for password inputs. */
const PASSWORD_SELECTOR = 'input[type="password"]';

/** CSS selector for visible text-like inputs (excludes password and hidden). */
const TEXT_INPUT_SELECTOR =
  'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"])';

/**
 * Build the standard "empty miss" field match for a Page/Frame context.
 * @param ctx - Page or Frame that owns the negative result.
 * @returns IFieldMatch with empty selector.
 */
function emptyMatch(ctx: Page | Frame): IFieldMatch {
  return { selector: '', context: ctx };
}

/**
 * Compose an `#id` selector when an id is present, otherwise return the fallback.
 * @param fallback - Selector used when no element id is present.
 * @param id - DOM id (empty string ⇒ no id).
 * @returns Best-available selector.
 */
function buildIdSelector(fallback: string, id: string): string {
  return id ? `#${id}` : fallback;
}

/**
 * Probe `locator.count()` swallowing playwright failures (defaults to 0).
 * @param locator - Locator to probe.
 * @returns Element count, 0 on failure.
 */
async function probeLocatorCount(locator: Locator): Promise<number> {
  return locator.count().catch((): number => 0);
}

/**
 * Probe `locator.isVisible()` swallowing playwright failures (defaults to false).
 * @param locator - Locator to probe.
 * @returns True when visible, false otherwise.
 */
async function probeLocatorVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch((): boolean => false);
}

/**
 * Probe `locator.isEnabled()` swallowing playwright failures (defaults to false).
 * @param locator - Locator to probe.
 * @returns True when enabled, false otherwise.
 */
async function probeLocatorEnabled(locator: Locator): Promise<boolean> {
  return locator.isEnabled().catch((): boolean => false);
}

/**
 * Probe a locator's DOM `id` attribute, returning '' on miss or failure.
 * @param locator - Locator to probe.
 * @returns DOM id or empty string.
 */
async function probeLocatorId(locator: Locator): Promise<string> {
  const id = await locator.getAttribute('id').catch((): string => '');
  return id ?? '';
}

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
  const all = frame.locator(TEXT_INPUT_SELECTOR);
  const targetOpt = await probeTextAtIndex(all, index);
  if (!targetOpt.has) return emptyMatch(frame);
  const elemId = await probeLocatorId(targetOpt.value);
  const fallback = `${TEXT_INPUT_SELECTOR} >> nth=${String(index)}`;
  const selector = buildIdSelector(fallback, elemId);
  LOG.debug({ field: `heuristic:${fieldKey}`, result: 'FOUND' });
  return { selector, context: frame, kind: 'css' };
}

/** Handler signature for a single heuristic strategy variant. */
type StrategyHandler = (
  frame: Frame,
  fieldKey: string,
  strategy: HeuristicStrategy,
) => Promise<IFieldMatch>;

/** Dispatch table mapping each strategy variant to its handler. */
const STRATEGY_HANDLERS: Record<HeuristicStrategy['type'], StrategyHandler> = {
  /**
   * Password-input heuristic — first `input[type="password"]`.
   * @param frame - Frame to probe.
   * @returns Field match (selector empty when not found).
   */
  password: async (frame): Promise<IFieldMatch> => resolvePasswordInFrame(frame),
  /**
   * Text-input heuristic — `index`-th visible/enabled text input.
   * @param frame - Frame to probe.
   * @param fieldKey - Credential key for logging.
   * @param strategy - Strategy carrying the positional index.
   * @returns Field match (selector empty when not found).
   */
  text: async (frame, fieldKey, strategy): Promise<IFieldMatch> => {
    const textStrategy = strategy as ITextStrategy;
    return resolveTextByIndex(frame, textStrategy.index, fieldKey);
  },
};

/**
 * Resolve a field using heuristics within a specific frame.
 * Wraps in try/catch so mock frames without .locator() fail gracefully.
 * @param frame - The page or frame to search.
 * @param fieldKey - The field type (id, password, etc).
 * @returns Field match with selector, or empty if not found.
 */
async function heuristicResolveInFrame(
  frame: Page | Frame,
  fieldKey: string,
): Promise<IFieldMatch> {
  const strategy = HEURISTIC_MAP[fieldKey];
  if (!strategy) return emptyMatch(frame);
  const handler = STRATEGY_HANDLERS[strategy.type];
  return handler(frame as Frame, fieldKey, strategy).catch((): IFieldMatch => emptyMatch(frame));
}

/**
 * Convert a heuristic match to IFieldContext.
 * @param match - The field match from heuristic resolution.
 * @param fieldKey - Credential key for logging.
 * @returns IFieldContext with heuristic metadata.
 */
function toHeuristicContext(match: IFieldMatch, fieldKey: string): IFieldContext {
  LOG.debug({ field: `heuristic:${fieldKey}`, result: 'FOUND' });
  const { selector, context } = match;
  return {
    isResolved: true,
    selector,
    context,
    resolvedVia: 'heuristic',
    round: 'heuristic',
    resolvedKind: 'css',
  };
}

/**
 * Probe frames recursively — first match wins.
 * @param frames - Child frames to search.
 * @param fieldKey - Credential key.
 * @param index - Current frame index.
 * @returns IFieldContext if found, or false.
 */
async function probeFrameAt(
  frames: readonly Frame[],
  fieldKey: string,
  index: number,
): Promise<IFieldContext | false> {
  if (index >= frames.length) return false;
  const match = await heuristicResolveInFrame(frames[index], fieldKey);
  if (match.selector) return toHeuristicContext(match, fieldKey);
  return probeFrameAt(frames, fieldKey, index + 1);
}

/**
 * Search all child iframes using heuristic type-based resolution.
 * @param page - The Playwright page.
 * @param fieldKey - The credential key to resolve.
 * @returns IFieldContext if found, or false if no frame had a match.
 */
async function heuristicProbeIframes(page: Page, fieldKey: string): Promise<IFieldContext | false> {
  const mainFrame = page.mainFrame();
  const childFrames = page.frames().filter(f => f !== mainFrame);
  if (childFrames.length === 0) return false;
  const count = String(childFrames.length);
  const masked = maskVisibleText(fieldKey);
  LOG.debug({ message: `Round 3: searching ${count} iframe(s) for "${masked}"` });
  return probeFrameAt(childFrames, fieldKey, 0);
}

/**
 * Try heuristic resolution — entry point called by PipelineFieldResolver.
 * When pageOrFrame is a Page: searches all child iframes.
 * When pageOrFrame is a Frame (scoped): probes THAT frame directly (sticky frame).
 * @param pageOrFrame - The Playwright page or frame.
 * @param fieldKey - The credential key to resolve.
 * @returns IFieldContext if found, or false if heuristic failed.
 */
/**
 * Probe iframes first, then fall back to main frame.
 * @param page - The Playwright page.
 * @param fieldKey - The credential key to resolve.
 * @returns IFieldContext if found, or false.
 */
async function probePageHeuristic(page: Page, fieldKey: string): Promise<IFieldContext | false> {
  const iframeResult = await heuristicProbeIframes(page, fieldKey);
  if (iframeResult) return iframeResult;
  const masked = maskVisibleText(fieldKey);
  LOG.debug({ message: `Round 3 (heuristic): trying main page for "${masked}"` });
  const mainFrame = page.mainFrame();
  const mainMatch = await heuristicResolveInFrame(mainFrame, fieldKey);
  if (mainMatch.selector) return toHeuristicContext(mainMatch, fieldKey);
  return false;
}

/**
 * Try heuristic resolution — entry point called by PipelineFieldResolver.
 * When pageOrFrame is a Page: searches all child iframes.
 * When pageOrFrame is a Frame (scoped): probes THAT frame directly (sticky frame).
 * @param pageOrFrame - The Playwright page or frame.
 * @param fieldKey - The credential key to resolve.
 * @returns IFieldContext if found, or false if heuristic failed.
 */
async function tryHeuristicProbe(
  pageOrFrame: Page | Frame,
  fieldKey: string,
): Promise<IFieldContext | false> {
  if (isPage(pageOrFrame)) return probePageHeuristic(pageOrFrame, fieldKey);
  const match = await heuristicResolveInFrame(pageOrFrame, fieldKey);
  if (!match.selector) return false;
  return toHeuristicContext(match, fieldKey);
}

export default tryHeuristicProbe;
export { heuristicResolveInFrame, tryHeuristicProbe };
