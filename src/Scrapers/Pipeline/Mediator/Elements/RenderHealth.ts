/**
 * RenderHealth — a cheap, PII-free probe of whether a page actually painted.
 *
 * <p>Every existing HOME.POST signal describes *navigation*, not *rendering*.
 * When a bank served its document but its stylesheets or bundles never
 * arrived, the trace reported a perfectly ordinary `didNavigate: true,
 * loginForm: false` — indistinguishable from a markup change — and the only
 * way to tell the two apart was to open the screenshot and look at its byte
 * size. These counters put that distinction in the log.
 *
 * <p>Diagnostic only: nothing here decides whether a phase passes. It reports
 * three integers, so it can never leak page content.
 */

import type { Page } from 'playwright-core';

import { timeoutPromise } from '../Timing/TimingActions.js';

/** Raw counters read from the document. Integers only — never page content. */
interface IRenderCounts {
  readonly elements: number;
  readonly styleSheets: number;
  readonly bodyHeight: number;
}

/** Whether the counters were actually read, or stood in for a failed probe. */
type RenderProbeStatus = 'observed' | 'unknown';

/** Render counters plus the blank-page verdict derived from them. */
interface IRenderHealth extends IRenderCounts {
  readonly isRendered: boolean;
  readonly status: RenderProbeStatus;
}

/**
 * Element count at or below which a document is treated as blank.
 *
 * <p>A bank homepage that painted carries hundreds of elements; an error
 * shell, a stalled SPA mount or an empty body carries a handful.
 */
const BLANK_PAGE_MAX_ELEMENTS = 20;

/** Body height at or below which a document is treated as blank, in pixels. */
const BLANK_PAGE_MAX_BODY_HEIGHT_PX = 100;

/** Budget for the probe. It is a synchronous DOM read, so this is generous. */
const RENDER_PROBE_TIMEOUT_MS = 5_000;

/**
 * Reported when the probe could not run.
 *
 * <p>Its counters are zeroed, which is also what a document with no body
 * yields — so `status` is what separates "the probe failed" from "the page
 * is definitely blank". Without it the two are byte-identical in the trace,
 * and telling them apart is the whole point of this module.
 */
const UNKNOWN_RENDER: IRenderHealth = {
  elements: 0,
  styleSheets: 0,
  bodyHeight: 0,
  isRendered: false,
  status: 'unknown',
};

/**
 * Read the render counters inside the page.
 *
 * <p>Runs in the browser realm, so it must stay self-contained. Tag-name
 * traversal is used rather than a selector query because this file is not
 * interaction code and should not introduce a selector of any kind.
 * @returns The three counters, zeroed when there is no body yet.
 */
function readRenderCounts(): IRenderCounts {
  const body = document.body as HTMLElement | null;
  if (body === null) return { elements: 0, styleSheets: 0, bodyHeight: 0 };
  return {
    elements: body.getElementsByTagName('*').length,
    styleSheets: document.styleSheets.length,
    bodyHeight: Math.round(body.scrollHeight),
  };
}

/**
 * Decide whether the counters describe a page that painted.
 *
 * <p>Stylesheet count deliberately does not vote: a document whose CSS was
 * blocked but whose DOM arrived did render, just unstyled. The count is
 * reported so a zero is visible in the log, which is what makes a failed
 * asset load readable without opening a screenshot.
 * @param counts - Raw counters read from the document.
 * @returns True when the document carries a real, laid-out body.
 */
function isRenderedFrom(counts: IRenderCounts): boolean {
  const hasContent = counts.elements > BLANK_PAGE_MAX_ELEMENTS;
  const hasHeight = counts.bodyHeight > BLANK_PAGE_MAX_BODY_HEIGHT_PX;
  return hasContent && hasHeight;
}

/**
 * Read the counters from the page, or report that the read was impossible.
 *
 * <p>`page.evaluate` can reject *or* throw synchronously — a detached or
 * closed page does the latter — so both paths are caught here rather than
 * relying on a promise-only guard.
 * @param page - The page to read.
 * @returns The counters, or false when the read could not complete.
 */
async function readCountsSafely(page: Page): Promise<IRenderCounts | false> {
  try {
    const pending = page.evaluate(readRenderCounts);
    return await timeoutPromise(RENDER_PROBE_TIMEOUT_MS, pending, 'render-health probe');
  } catch {
    return false;
  }
}

/**
 * Measure render health for a page.
 *
 * <p>Best-effort by design: a probe that threw or outlived its budget reports
 * {@link UNKNOWN_RENDER} rather than propagating, because a diagnostic must
 * never be able to fail the phase it is describing.
 * @param page - The page to measure.
 * @returns Counters plus the blank-page verdict.
 */
async function measureRenderHealth(page: Page): Promise<IRenderHealth> {
  const counts = await readCountsSafely(page);
  if (counts === false) return UNKNOWN_RENDER;
  const isRendered = isRenderedFrom(counts);
  return { ...counts, isRendered, status: 'observed' };
}

export type { IRenderCounts, IRenderHealth, RenderProbeStatus };
export {
  BLANK_PAGE_MAX_BODY_HEIGHT_PX,
  BLANK_PAGE_MAX_ELEMENTS,
  isRenderedFrom,
  measureRenderHealth,
  UNKNOWN_RENDER,
};
