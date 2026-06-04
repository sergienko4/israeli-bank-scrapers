/**
 * Element wait helpers — waitForSelector, waitForIframe, disappear.
 * Extracted from ElementsInteractions.ts to respect max-lines.
 */

import type { Frame, Page } from 'playwright-core';

import ScraperError from '../../../Base/ScraperError.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { waitUntil } from '../Timing/Waiting.js';
import { IFRAME_DEFAULT_TIMEOUT_MS, IFRAME_POLL_INTERVAL_MS } from './ElementsInteractionConfig.js';
import { capturePageText, type IWaitOptions } from './ElementsInteractions.js';

const LOG = createLogger('elements-wait');

/**
 * Resolve the Playwright wait state from the visibility flag.
 * @param visible - Whether to wait for visibility.
 * @returns 'visible' or 'attached'.
 */
function resolveWaitState(visible?: boolean): 'visible' | 'attached' {
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
  selector: string,
  startMs: number,
): Promise<boolean> {
  const elapsedStr = String(Date.now() - startMs);
  LOG.debug({
    message: `waitForSelector ${maskVisibleText(selector)} → found (${elapsedStr}ms)`,
  });
  const html = await captureElementHtml(ctx, selector);
  LOG.debug({
    message: `element html: ${maskVisibleText(html)}`,
  });
  return true;
}

/** Bundled args for timeout diagnostics. */
interface ITimeoutDiagArgs {
  readonly ctx: Page | Frame;
  readonly selector: string;
  readonly startMs: number;
}

/**
 * Log timeout diagnostics and rethrow.
 * @param args - Bundled diagnostic arguments.
 * @param error - The caught timeout error.
 * @returns Never — always rethrows.
 */
async function logTimeoutDiagnostics(args: ITimeoutDiagArgs, error: unknown): Promise<never> {
  const elapsedStr = String(Date.now() - args.startMs);
  LOG.debug({
    message: `waitForSelector ${maskVisibleText(args.selector)} → TIMEOUT (${elapsedStr}ms)`,
  });
  const text = await capturePageText(args.ctx);
  LOG.debug({
    message: `page text: ${maskVisibleText(text)}`,
  });
  throw error;
}

/**
 * Capture outer HTML of a matched element for diagnostics.
 * @param ctx - Page or frame.
 * @param selector - CSS selector.
 * @returns Truncated outer HTML.
 */
async function captureElementHtml(ctx: Page | Frame, selector: string): Promise<string> {
  const limit = 200;
  return ctx
    .evaluate(
      ({ sel, lim }: { sel: string; lim: number }): string =>
        document.querySelector(sel)?.outerHTML.slice(0, lim) ?? '—',
      { sel: selector, lim: limit },
    )
    .catch((): string => '(context unavailable)');
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
  selector: string,
  opts: IWaitOptions = {},
): Promise<boolean> {
  const state = resolveWaitState(opts.visible);
  const startMs = Date.now();
  try {
    await ctx.waitForSelector(selector, { state, timeout: opts.timeout });
    return await logFoundDiagnostics(ctx, selector, startMs);
  } catch (error) {
    return logTimeoutDiagnostics({ ctx, selector, startMs }, error);
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
  selector: string,
  timeout?: number,
): Promise<boolean> {
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
  framePredicate: (frame: Frame) => boolean,
  timeout: number,
): Promise<Frame | false> {
  let frame: Frame | false = false;
  await waitUntil(
    (): Promise<boolean> => {
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
  framePredicate: (frame: Frame) => boolean,
  opts: IWaitOptions & { description?: string } = {},
): Promise<Frame> {
  const { timeout = IFRAME_DEFAULT_TIMEOUT_MS, description = '' } = opts;
  const frame = await waitForIframe(ctx, framePredicate, timeout);
  if (frame === false) throw new ScraperError(`failed to find iframe: ${description}`);
  return frame;
}

export { waitUntilElementDisappear, waitUntilElementFound, waitUntilIframeFound };
