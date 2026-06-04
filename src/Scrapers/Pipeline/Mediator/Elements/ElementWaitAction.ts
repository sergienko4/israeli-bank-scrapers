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
 * Format the success diagnostic line.
 * @param selector - Matched selector.
 * @param elapsedMs - Elapsed wall-clock since wait started.
 * @returns Structured log message.
 */
function buildFoundMessage(selector: string, elapsedMs: number): { message: string } {
  const elapsedStr = String(elapsedMs);
  const masked = maskVisibleText(selector);
  return { message: `waitForSelector ${masked} → found (${elapsedStr}ms)` };
}

/** Bundled args for wait diagnostics — used by both success + timeout helpers. */
interface IWaitDiagArgs {
  readonly ctx: Page | Frame;
  readonly selector: string;
  readonly startMs: number;
}

/**
 * Log success diagnostics after element found.
 * @param args - Bundled context + selector + startMs.
 * @returns True after logging.
 */
async function logFoundDiagnostics(args: IWaitDiagArgs): Promise<boolean> {
  const found = buildFoundMessage(args.selector, Date.now() - args.startMs);
  LOG.debug(found);
  const html = await captureElementHtml(args.ctx, args.selector);
  const masked = maskVisibleText(html);
  LOG.debug({ message: `element html: ${masked}` });
  return true;
}

/**
 * Format the timeout diagnostic line.
 * @param selector - Matched selector.
 * @param elapsedMs - Elapsed wall-clock at timeout.
 * @returns Structured log message.
 */
function buildTimeoutMessage(selector: string, elapsedMs: number): { message: string } {
  const elapsedStr = String(elapsedMs);
  const masked = maskVisibleText(selector);
  return { message: `waitForSelector ${masked} → TIMEOUT (${elapsedStr}ms)` };
}

/**
 * Log timeout diagnostics and rethrow.
 * @param args - Bundled diagnostic arguments.
 * @param error - The caught timeout error.
 * @returns Never — always rethrows.
 */
async function logTimeoutDiagnostics(args: IWaitDiagArgs, error: unknown): Promise<never> {
  const timeoutPayload = buildTimeoutMessage(args.selector, Date.now() - args.startMs);
  LOG.debug(timeoutPayload);
  const text = await capturePageText(args.ctx);
  LOG.debug({ message: `page text: ${maskVisibleText(text)}` });
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

/** Bundled args for the diagnostic-bearing waitForSelector helper. */
interface IWaitDiagSpec {
  readonly state: 'visible' | 'attached';
  readonly timeout?: number;
  readonly startMs: number;
}

/** Args bundle for runWaitWithDiagnostics to satisfy ≤10-line cap. */
interface IRunWaitDiagArgs {
  readonly ctx: Page | Frame;
  readonly selector: string;
  readonly spec: IWaitDiagSpec;
}

/**
 * Drive the `waitForSelector` call and surface success or timeout
 * via the diagnostic helpers — extracted Phase-2a-B helper so the
 * orchestrator stays ≤10 lines.
 * @param a - Bundled ctx + selector + spec.
 * @returns True on found; never on timeout (rethrows).
 */
async function runWaitWithDiagnostics(a: IRunWaitDiagArgs): Promise<boolean> {
  const da = { ctx: a.ctx, selector: a.selector, startMs: a.spec.startMs };
  try {
    await a.ctx.waitForSelector(a.selector, { state: a.spec.state, timeout: a.spec.timeout });
    return await logFoundDiagnostics(da);
  } catch (error) {
    return logTimeoutDiagnostics(da, error);
  }
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
  return runWaitWithDiagnostics({ ctx, selector, spec: { state, timeout: opts.timeout, startMs } });
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

/** Args bundle for waitForIframe to satisfy ≤10-line cap. */
interface IWaitForIframeArgs {
  readonly ctx: Page;
  readonly framePredicate: (frame: Frame) => boolean;
  readonly timeout: number;
}

/**
 * Wait for a matching iframe to appear.
 * @param a - Bundled page + frame predicate + timeout.
 * @returns Matched frame, or false.
 */
async function waitForIframe(a: IWaitForIframeArgs): Promise<Frame | false> {
  let frame: Frame | false = false;
  /**
   * Poll-step closure capturing the outer `frame` slot.
   * @returns True once the predicate matches an attached frame.
   */
  const checkOnce = (): Promise<boolean> => {
    frame = a.ctx.frames().find(a.framePredicate) ?? false;
    return Promise.resolve(frame !== false);
  };
  const wopts = { timeout: a.timeout, interval: IFRAME_POLL_INTERVAL_MS };
  await waitUntil(checkOnce, 'waiting for iframe', wopts);
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
  const frame = await waitForIframe({ ctx, framePredicate, timeout });
  if (frame === false) throw new ScraperError(`failed to find iframe: ${description}`);
  return frame;
}

export { waitUntilElementDisappear, waitUntilElementFound, waitUntilIframeFound };
