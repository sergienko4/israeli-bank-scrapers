/**
 * Unit tests for Interceptors/SnapshotDeepDom — captureDeepHtml.
 */

import type { Page } from 'playwright-core';

import { captureDeepHtml } from '../../../../Scrapers/Pipeline/Interceptors/SnapshotDeepDom.js';

/** Options for the mock Page. */
interface IMakePageOpts {
  evaluateResult: string;
  evaluateThrows?: boolean;
  contentResult?: string;
  contentThrows?: boolean;
}

/**
 * Build a mock Page whose evaluate returns or throws on demand.
 * @param opts - Configuration for the mock page's evaluate/content behavior.
 * @returns Mock Page.
 */
function makePage(opts: IMakePageOpts): Page {
  const {
    evaluateResult,
    evaluateThrows: willEvaluateThrow = false,
    contentResult = '',
    contentThrows: willContentThrow = false,
  } = opts;
  return {
    /**
     * evaluate.
     * @returns Scripted.
     */
    evaluate: (): Promise<string> => {
      if (willEvaluateThrow) return Promise.reject(new Error('eval fail'));
      return Promise.resolve(evaluateResult);
    },
    /**
     * content.
     * @returns Scripted fallback.
     */
    content: (): Promise<string> => {
      if (willContentThrow) return Promise.reject(new Error('content fail'));
      return Promise.resolve(contentResult);
    },
  } as unknown as Page;
}

describe('captureDeepHtml', () => {
  it('returns serialized HTML from evaluate when successful', async () => {
    const page = makePage({ evaluateResult: '<html>X</html>' });
    const html = await captureDeepHtml(page);
    expect(html).toContain('<html>X</html>');
  });

  it('falls back to content() when evaluate returns empty', async () => {
    const page = makePage({ evaluateResult: '', contentResult: '<html>FALLBACK</html>' });
    const html = await captureDeepHtml(page);
    expect(html).toContain('FALLBACK');
  });

  it('falls back to content() when evaluate throws', async () => {
    const page = makePage({
      evaluateResult: '',
      evaluateThrows: true,
      contentResult: '<html>OK</html>',
    });
    const html = await captureDeepHtml(page);
    expect(html).toContain('OK');
  });

  it('returns empty string when both evaluate and content fail', async () => {
    const page = makePage({
      evaluateResult: '',
      evaluateThrows: true,
      contentResult: '',
      contentThrows: true,
    });
    const html = await captureDeepHtml(page);
    expect(html).toBe('');
  });
});
