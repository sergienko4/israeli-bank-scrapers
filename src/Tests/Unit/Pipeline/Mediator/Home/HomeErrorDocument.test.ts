/**
 * Unit tests for HomeErrorDocument — the read-only probe that decides
 * whether HOME landed on the bank's error page instead of its homepage.
 *
 * <p>Motivating incident: Discount's edge served the bank's own branded 404
 * under HTTP 200. Every INIT stage passed it (the landing guard reads status,
 * and 200 is healthy), and the run failed three phases later at HOME with
 * "no login nav link found" — true, but unattributable without downloading a
 * forensic bundle. These tests pin the probe that makes the real cause legible.
 */

import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  ERROR_CODE_PATTERN,
  errorDocumentMessage,
  isErrorDocument,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeErrorDocument.js';

/** Records the selectors a probe asked the mediator to count. */
interface IProbeLog {
  readonly selectors: string[];
}

/**
 * Build a mediator whose selector count is scripted and recorded.
 * @param count - Element count to report, or 'throws' to reject.
 * @param log - Selector log to append to.
 * @returns Mock mediator exposing only the probe surface.
 */
function makeProbeMediator(count: number | 'throws', log: IProbeLog): IElementMediator {
  /**
   * Record the selector then report the scripted count.
   * @param selector - Selector the probe asked about.
   * @returns Scripted count, or a rejection.
   */
  const countBySelector = (selector: string): Promise<number> => {
    log.selectors.push(selector);
    if (count === 'throws') return Promise.reject(new Error('probe exploded'));
    return Promise.resolve(count);
  };
  return { countBySelector } as unknown as IElementMediator;
}

/**
 * Run the probe against a scripted element count.
 * @param count - Element count the mediator reports.
 * @returns The verdict and the selectors the probe used.
 */
async function probe(count: number | 'throws'): Promise<{ isError: boolean; log: IProbeLog }> {
  const log: IProbeLog = { selectors: [] };
  const mediator = makeProbeMediator(count, log);
  const isError = await isErrorDocument(mediator);
  return { isError, log };
}

describe('isErrorDocument', () => {
  it('reports an error document when a bare status-code heading is present', async () => {
    const { isError } = await probe(1);
    expect(isError).toBe(true);
  });

  it('reports no error document when the page carries no status-code heading', async () => {
    const { isError } = await probe(0);
    expect(isError).toBe(false);
  });

  it('reads the document through the mediator, never through Playwright', async () => {
    const { log } = await probe(1);
    expect(log.selectors).toHaveLength(1);
  });

  it('probes both h1 and h2 so markup variance does not hide the heading', async () => {
    const { log } = await probe(1);
    expect(log.selectors[0]).toContain('h1:text-matches');
    expect(log.selectors[0]).toContain('h2:text-matches');
  });

  it('stays silent when the probe itself fails, never inventing a diagnosis', async () => {
    const { isError } = await probe('throws');
    expect(isError).toBe(false);
  });
});

describe('ERROR_CODE_PATTERN', () => {
  /**
   * Test the production pattern against one heading text.
   * @param text - Heading text to classify.
   * @returns Whether the pattern treats it as a bare status code.
   */
  const matches = (text: string): boolean => new RegExp(ERROR_CODE_PATTERN).test(text);

  it.each(['404', '403', '500', '503', ' 404 '])('treats %j as an error-status heading', text => {
    const isMatch = matches(text);
    expect(isMatch).toBe(true);
  });

  it.each(['404 - Page not found', 'Error 500', '2024', '304', '200', '', 'Login'])(
    'does not treat %j as an error-status heading',
    text => {
      const isMatch = matches(text);
      expect(isMatch).toBe(false);
    },
  );

  it('carries no backslash escapes, so the Playwright selector parser cannot eat them', () => {
    expect(ERROR_CODE_PATTERN).not.toContain('\\');
  });
});

describe('errorDocumentMessage', () => {
  it('names the URL so the failure is actionable without a forensic bundle', () => {
    const message = errorDocumentMessage('https://www.discountbank.co.il');
    expect(message).toContain('https://www.discountbank.co.il');
  });

  it('says the bank served an error document rather than blaming discovery', () => {
    const message = errorDocumentMessage('https://www.discountbank.co.il');
    expect(message).toContain('error document');
  });

  it('still reads as a HOME PRE failure so log greps keep working', () => {
    const message = errorDocumentMessage('https://bank.test');
    expect(message).toMatch(/^HOME PRE:/);
  });
});
