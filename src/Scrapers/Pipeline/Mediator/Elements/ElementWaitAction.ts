/**
 * Element wait helpers — waitForSelector, waitForIframe, disappear.
 * Extracted from ElementsInteractions.ts to respect max-lines.
 */

import type { Frame, Page } from 'playwright-core';

import ScraperError from '../../../Base/ScraperError.js';
import { waitUntil } from '../../Phases/Timing/Waiting.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { IFRAME_DEFAULT_TIMEOUT_MS, IFRAME_POLL_INTERVAL_MS } from './ElementsInteractionConfig.js';
import { capturePageText, type IWaitOptions } from './ElementsInteractions.js';

const LOG = createLogger('elements-wait');

type SelectorStr = string;
type OpResult = boolean;
type TimeoutMs = number;
type PageText = string;
type HtmlCapture = string;

/**
 * Resolve the Playwright wait state from the visibility flag.
 * @param visible - Whether to wait for visibility.
 * @returns 'visible' or 'attached'.
 */
function resolveWaitState(visible?: OpResult): 'visible' | 'attached' {
  if (visible) return 'visible';
  return 'attached';
}

/**
 * Log success diagnostics after element found.
 * @param ctx - Page or frame.
 * @param selector - Matched selector.
 * @param startMs - Timing start.
 * @returns True after logging.
 */
async function logFoundDiagnostics(
  ctx: Page | Frame,
  selector: SelectorStr,
  startMs: number,
): Promise<OpResult> {
  LOG.debug('waitForSelector %s → found (%dms)', selector, Date.now() - startMs);
  const html = await captureElementHtml(ctx, selector);
  LOG.debug('element html: %s', html);
  return true;
}

/** Bundled args for timeout diagnostics. */
interface ITimeoutDiagArgs {
  readonly ctx: Page | Frame;
  readonly selector: SelectorStr;
  readonly startMs: TimeoutMs;
}

/**
 * Log timeout diagnostics and rethrow.
 * @param args - Bundled diagnostic arguments.
 * @param error - The caught timeout error.
 * @returns Never — always rethrows.
 */
async function logTimeoutDiagnostics(args: ITimeoutDiagArgs, error: Error): Promise<never> {
  LOG.debug('waitForSelector %s → TIMEOUT (%dms)', args.selector, Date.now() - args.startMs);
  const text = await capturePageText(args.ctx);
  LOG.debug('page text: %s', text);
  throw error;
}

/**
 * Capture outer HTML of a matched element for diagnostics.
 * @param ctx - Page or frame.
 * @param selector - CSS selector.
 * @returns Truncated outer HTML.
 */
async function captureElementHtml(ctx: Page | Frame, selector: SelectorStr): Promise<HtmlCapture> {
  const limit = 200;
  return ctx
    .evaluate(
      ({ sel, lim }: { sel: SelectorStr; lim: number }): HtmlCapture =>
        document.querySelector(sel)?.outerHTML.slice(0, lim) ?? '—',
      { sel: selector, lim: limit },
    )
    .catch((): HtmlCapture => '(context unavailable)');
}

/**
 * Wait until a selector is present (or visible).
 * @param ctx - Page or frame.
 * @param selector - CSS selector.
 * @param opts - Visibility and timeout.
 * @returns True after found.
 */
async function waitUntilElementFound(
  ctx: Page | Frame,
  selector: SelectorStr,
  opts: IWaitOptions = {},
): Promise<OpResult> {
  const state = resolveWaitState(opts.visible);
  const startMs = Date.now();
  try {
    await ctx.waitForSelector(selector, { state, timeout: opts.timeout });
    return await logFoundDiagnostics(ctx, selector, startMs);
  } catch (e) {
    return logTimeoutDiagnostics({ ctx, selector, startMs }, e as Error);
  }
}

/**
 * Wait until a selector disappears (hidden).
 * @param ctx - Page.
 * @param selector - CSS selector.
 * @param timeout - Optional timeout.
 * @returns True after hidden.
 */
async function waitUntilElementDisappear(
  ctx: Page,
  selector: SelectorStr,
  timeout?: TimeoutMs,
): Promise<OpResult> {
  await ctx.waitForSelector(selector, { state: 'hidden', timeout });
  return true;
}

/**
 * Wait for a matching iframe to appear.
 * @param ctx - Page.
 * @param framePredicate - Returns true for target frame.
 * @param timeout - Max wait time.
 * @returns Matched frame, or false.
 */
async function waitForIframe(
  ctx: Page,
  framePredicate: (frame: Frame) => OpResult,
  timeout: TimeoutMs,
): Promise<Frame | false> {
  let frame: Frame | false = false;
  await waitUntil(
    (): Promise<OpResult> => {
      frame = ctx.frames().find(framePredicate) ?? false;
      return Promise.resolve(frame !== false);
    },
    'waiting for iframe',
    { timeout, interval: IFRAME_POLL_INTERVAL_MS },
  );
  return frame;
}

/**
 * Wait for a matching iframe and throw if not found.
 * @param ctx - Page.
 * @param framePredicate - Returns true for target frame.
 * @param opts - Timeout and description.
 * @returns Matched frame.
 */
async function waitUntilIframeFound(
  ctx: Page,
  framePredicate: (frame: Frame) => OpResult,
  opts: IWaitOptions & { description?: PageText } = {},
): Promise<Frame> {
  const { timeout = IFRAME_DEFAULT_TIMEOUT_MS, description = '' } = opts;
  const frame = await waitForIframe(ctx, framePredicate, timeout);
  if (frame === false) throw new ScraperError(`failed to find iframe: ${description}`);
  return frame;
}

export { waitUntilElementDisappear, waitUntilElementFound, waitUntilIframeFound };
