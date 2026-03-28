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

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../Types/Debug.js';
import { isPage } from './SelectorResolver.js';
import type { IFieldContext, IFieldMatch } from './SelectorResolverPipeline.js';

const LOG = getDebug('heuristic-resolver');

/** Position index for non-password visible inputs. */
type InputIndex = number;
/** CSS selector string resolved by heuristic. */
type HeuristicSelector = string;
/** Whether the heuristic found a viable input. */
type IsViable = boolean;

/** Strategy for resolving a password-type field. */
interface IPasswordStrategy {
  readonly type: 'password';
}

/** Strategy for resolving a text-type field by positional index. */
interface ITextStrategy {
  readonly type: 'text';
  readonly index: InputIndex;
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
const TEXT_INPUT_SELECTOR = 'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"])';

/**
 * Try to resolve a password field in the given frame.
 * @param frame - The iframe to search in.
 * @returns Field match with selector, or empty if not found.
 */
async function resolvePasswordInFrame(frame: Frame): Promise<IFieldMatch> {
  const locator = frame.locator(PASSWORD_SELECTOR).first();
  const count = await locator.count().catch((): InputIndex => 0);
  if (count === 0) return { selector: '', context: frame };
  const isVis: IsViable = await locator.isVisible().catch((): IsViable => false);
  if (!isVis) return { selector: '', context: frame };
  const elemId = await locator.getAttribute('id').catch((): HeuristicSelector => '');
  const selector = elemId ? `#${elemId}` : PASSWORD_SELECTOR;
  LOG.debug('Round 3 (heuristic): resolved password → %s', selector);
  return { selector, context: frame, kind: 'css' };
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
  index: InputIndex,
  fieldKey: string,
): Promise<IFieldMatch> {
  const all = frame.locator(TEXT_INPUT_SELECTOR);
  const total = await all.count().catch((): InputIndex => 0);
  if (index >= total) return { selector: '', context: frame };
  const target = all.nth(index);
  const isVis: IsViable = await target.isVisible().catch((): IsViable => false);
  if (!isVis) return { selector: '', context: frame };
  const isEnabled: IsViable = await target.isEnabled().catch((): IsViable => false);
  if (!isEnabled) return { selector: '', context: frame };
  const elemId = await target.getAttribute('id').catch((): HeuristicSelector => '');
  const selector = elemId ? `#${elemId}` : `${TEXT_INPUT_SELECTOR} >> nth=${String(index)}`;
  LOG.debug('Round 3 (heuristic): resolved %s → %s (index %d of %d)', fieldKey, selector, index, total);
  return { selector, context: frame, kind: 'css' };
}

/**
 * Try heuristic resolution in a single frame.
 * @param frame - The iframe to search.
 * @param fieldKey - The credential key to resolve.
 * @returns Field match or empty.
 */
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
  if (!strategy) return { selector: '', context: frame };
  if (strategy.type === 'password') return resolvePasswordInFrame(frame as Frame).catch((): IFieldMatch => ({ selector: '', context: frame }));
  const empty: IFieldMatch = { selector: '', context: frame };
  try {
    const result = await resolveTextByIndex(frame as Frame, strategy.index, fieldKey);
    return result;
  } catch {
    return empty;
  }
}

/**
 * Convert a heuristic match to IFieldContext.
 * @param match - The field match from heuristic resolution.
 * @param fieldKey - Credential key for logging.
 * @returns IFieldContext with heuristic metadata.
 */
function toHeuristicContext(match: IFieldMatch, fieldKey: string): IFieldContext {
  const frameUrl = 'url' in match.context ? (match.context as Frame).url() : '';
  LOG.debug('Round 3 (heuristic): resolved %s → %s in frame %s', fieldKey, match.selector, frameUrl);
  return {
    isResolved: true,
    selector: match.selector,
    context: match.context,
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
async function heuristicProbeIframes(
  page: Page,
  fieldKey: string,
): Promise<IFieldContext | false> {
  const mainFrame = page.mainFrame();
  const childFrames = page.frames().filter(f => f !== mainFrame);
  if (childFrames.length === 0) return false;
  LOG.debug('Round 3 (heuristic): searching %d iframe(s) for "%s"', childFrames.length, fieldKey);
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
async function tryHeuristicProbe(
  pageOrFrame: Page | Frame,
  fieldKey: string,
): Promise<IFieldContext | false> {
  if (isPage(pageOrFrame)) return heuristicProbeIframes(pageOrFrame, fieldKey);
  // Scoped: probe this specific frame directly (sticky frame from previous field)
  const match = await heuristicResolveInFrame(pageOrFrame, fieldKey);
  if (!match.selector) return false;
  return toHeuristicContext(match, fieldKey);
}

export default tryHeuristicProbe;
export { heuristicResolveInFrame, tryHeuristicProbe };
