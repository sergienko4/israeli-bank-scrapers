/**
 * RenderHealth tests — the blank-page verdict and the probe's failure modes.
 *
 * <p>The point of this probe is that a failed render becomes readable from the
 * log alone. These tests pin the two halves of that promise: the verdict must
 * separate a painted page from a blank one, and a probe that cannot run must
 * report "not observed" rather than either extreme.
 */

import type { Page } from 'playwright-core';

import type { IRenderCounts } from '../../../../../Scrapers/Pipeline/Mediator/Elements/RenderHealth.js';
import {
  BLANK_PAGE_MAX_BODY_HEIGHT_PX,
  BLANK_PAGE_MAX_ELEMENTS,
  isRenderedFrom,
  measureRenderHealth,
  UNKNOWN_RENDER,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/RenderHealth.js';

/** Counters a fully painted bank homepage would produce. */
const HEALTHY_COUNTS: IRenderCounts = { elements: 842, styleSheets: 6, bodyHeight: 4310 };

/** Counters an empty error shell would produce. */
const BLANK_COUNTS: IRenderCounts = { elements: 3, styleSheets: 0, bodyHeight: 0 };

/**
 * Counters from a document with no body — the worst case for ambiguity.
 *
 * <p>These are the exact counters {@link UNKNOWN_RENDER} carries, so a
 * verdict built from them is what a failed probe would look like if the two
 * were not tagged apart.
 */
const EMPTY_COUNTS: IRenderCounts = { elements: 0, styleSheets: 0, bodyHeight: 0 };

/**
 * Build a page stub whose evaluate resolves with fixed counters.
 * @param counts - Counters the in-page read should report.
 * @returns Page stub exposing only `evaluate`.
 */
function makeCountingPage(counts: IRenderCounts): Page {
  return {
    /**
     * Report the scripted counters.
     * @returns The counters.
     */
    evaluate: (): Promise<IRenderCounts> => Promise.resolve(counts),
  } as unknown as Page;
}

/**
 * Build a page stub whose evaluate rejects.
 * @returns Page stub exposing only a failing `evaluate`.
 */
function makeFailingPage(): Page {
  return {
    /**
     * Reject the way a detached page would.
     * @returns Rejected promise.
     */
    evaluate: (): Promise<IRenderCounts> => Promise.reject(new Error('page closed')),
  } as unknown as Page;
}

/**
 * Build a page stub whose evaluate throws synchronously.
 *
 * <p>This is what a page object without an `evaluate` surface does, and it is
 * the shape that first escaped the probe's promise-only guard.
 * @returns Page stub with no usable `evaluate`.
 */
function makeUnevaluablePage(): Page {
  return {} as unknown as Page;
}

describe('RenderHealth — blank-page verdict', () => {
  it('reports a painted page as rendered', () => {
    const isRendered = isRenderedFrom(HEALTHY_COUNTS);
    expect(isRendered).toBe(true);
  });

  it('reports an empty shell as not rendered', () => {
    const isRendered = isRenderedFrom(BLANK_COUNTS);
    expect(isRendered).toBe(false);
  });

  it('treats a tall body with almost no elements as not rendered', () => {
    const counts: IRenderCounts = {
      elements: BLANK_PAGE_MAX_ELEMENTS,
      styleSheets: 2,
      bodyHeight: 5000,
    };
    const isRendered = isRenderedFrom(counts);
    expect(isRendered).toBe(false);
  });

  it('treats a populated body with no layout as not rendered', () => {
    const counts: IRenderCounts = {
      elements: 500,
      styleSheets: 2,
      bodyHeight: BLANK_PAGE_MAX_BODY_HEIGHT_PX,
    };
    const isRendered = isRenderedFrom(counts);
    expect(isRendered).toBe(false);
  });

  it('keeps an unstyled but populated page rendered, so a zero sheet count is only a signal', () => {
    const counts: IRenderCounts = { elements: 842, styleSheets: 0, bodyHeight: 4310 };
    const isRendered = isRenderedFrom(counts);
    expect(isRendered).toBe(true);
  });
});

describe('RenderHealth — measurement', () => {
  it('surfaces the counters alongside the verdict', async () => {
    const page = makeCountingPage(HEALTHY_COUNTS);
    const health = await measureRenderHealth(page);
    expect(health).toEqual({ ...HEALTHY_COUNTS, isRendered: true, status: 'observed' });
  });

  it('surfaces a failed render with its counters intact', async () => {
    const page = makeCountingPage(BLANK_COUNTS);
    const health = await measureRenderHealth(page);
    expect(health).toEqual({ ...BLANK_COUNTS, isRendered: false, status: 'observed' });
  });

  it('separates a blank page from a probe that could not run', async () => {
    const emptyPage = makeCountingPage(EMPTY_COUNTS);
    const failingPage = makeFailingPage();
    const blank = await measureRenderHealth(emptyPage);
    const unknown = await measureRenderHealth(failingPage);
    expect(blank).not.toEqual(unknown);
    expect(blank.status).toBe('observed');
    expect(unknown.status).toBe('unknown');
  });

  it('reports unknown rather than throwing when the probe cannot run', async () => {
    const page = makeFailingPage();
    const health = await measureRenderHealth(page);
    expect(health).toEqual(UNKNOWN_RENDER);
  });

  it('reports unknown when the page has no evaluate surface at all', async () => {
    const page = makeUnevaluablePage();
    const health = await measureRenderHealth(page);
    expect(health).toEqual(UNKNOWN_RENDER);
  });

  it('carries only integers, so it can never leak page content', async () => {
    const page = makeCountingPage(HEALTHY_COUNTS);
    const health = await measureRenderHealth(page);
    const scalars = [health.elements, health.styleSheets, health.bodyHeight];
    const isAllNumeric = scalars.every((value): boolean => Number.isInteger(value));
    expect(isAllNumeric).toBe(true);
  });
});
