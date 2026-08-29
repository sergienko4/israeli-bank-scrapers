/**
 * Landing-document classification tests.
 *
 * <p>Guards the two properties that make the probe safe to run on the
 * INIT success path of every bank: it fires only on a bare status-code
 * heading, and it stays silent whenever the driver refuses to answer.
 * A false positive here would fail a healthy run, so silence is always
 * the fallback.
 */

import { jest } from '@jest/globals';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type { ILandingDocumentSource } from '../../../../../Scrapers/Pipeline/Mediator/Init/LandingDocument.js';
import {
  errorDocumentMessage,
  isErrorDocument,
} from '../../../../../Scrapers/Pipeline/Mediator/Init/LandingDocument.js';
import {
  ERROR_HEADING_COUNT_TIMEOUT_MS,
  ERROR_HEADING_SELECTOR,
  INIT_ERROR_DOCUMENT_CODE,
} from '../../../../../Scrapers/Pipeline/Mediator/Init/LandingDocumentConfig.js';

/** Read-only count surface, mirrored so the stand-ins stay typed. */
interface ILandingLocator {
  count(): Promise<number>;
}

/** Slot receiving a pending promise's rejecter for later firing. */
interface IRejectSlot {
  fire?: (reason: Error) => unknown;
}

/**
 * Build a count that settles only when the test rejects it.
 *
 * <p>Hand-fired rather than timer-driven so the rejection can be placed
 * precisely after the probe has already abandoned the promise, which is
 * the moment an unobserved rejection would surface.
 *
 * @param slot - Slot receiving the rejecter.
 * @returns The pending count promise.
 */
function pendingCount(slot: IRejectSlot): Promise<number> {
  /**
   * Capture the rejecter so the test can fire it later.
   * @param _resolve - Unused; this count never succeeds.
   * @param reject - Rejecter stored in the slot.
   * @returns True once captured.
   */
  const arm = (_resolve: unknown, reject: (reason: Error) => unknown): boolean => {
    slot.fire = reject;
    return true;
  };
  return new Promise<number>(arm);
}

/**
 * Build a page stand-in whose locator reports a scripted match count.
 * @param count - Number of matching headings the stand-in reports.
 * @returns Source reporting that count for any selector.
 */
function makeSource(count: number): ILandingDocumentSource {
  /**
   * Report the scripted count.
   * @returns The scripted count.
   */
  const reportCount = (): Promise<number> => Promise.resolve(count);
  /**
   * Hand back a locator stand-in reporting the scripted count.
   * @returns Locator stand-in.
   */
  const makeLocator = (): { count: () => Promise<number> } => ({ count: reportCount });
  return { locator: makeLocator };
}

describe('isErrorDocument', () => {
  // The Discount failure this probe exists for: the edge served the
  // bank's own branded 404 under HTTP 200, so the status-based gate
  // could not see it and HOME failed three phases later.
  it('reports an error document when a status-code heading is present', async () => {
    const source = makeSource(1);
    const isError = await isErrorDocument(source);
    expect(isError).toBe(true);
  });

  it('stays silent on a healthy document with no status-code heading', async () => {
    const source = makeSource(0);
    const isError = await isErrorDocument(source);
    expect(isError).toBe(false);
  });

  // This runs on the success path of every bank, so a rejection must
  // never escape: an escaping throw would be caught by the phase and
  // reported as a wiring failure, turning a healthy landing into a
  // phantom failure.
  it('stays silent when the driver rejects the count', async () => {
    /**
     * Fail the way a disposed driver channel does.
     * @returns A rejected promise.
     */
    const rejectCount = (): Promise<number> => {
      const closed = new ScraperError('Target page, context or browser has been closed');
      return Promise.reject(closed);
    };
    /**
     * Hand back a locator stand-in whose count rejects.
     * @returns Locator stand-in.
     */
    const makeLocator = (): { count: () => Promise<number> } => ({ count: rejectCount });
    const hostile: ILandingDocumentSource = { locator: makeLocator };
    const isError = await isErrorDocument(hostile);
    expect(isError).toBe(false);
  });

  // Same reasoning one level earlier: `locator()` itself is a driver
  // call and is not obliged to be total.
  it('stays silent when the driver throws building the locator', async () => {
    /**
     * Throw the way a disposed driver does before returning a locator.
     * @returns Never — always throws.
     */
    const throwingLocator = (): { count: () => Promise<number> } => {
      throw new ScraperError('Target page, context or browser has been closed');
    };
    const isError = await isErrorDocument({ locator: throwingLocator });
    expect(isError).toBe(false);
  });

  it('asks for the status-code heading selector', async () => {
    const asked: string[] = [];
    /**
     * Report no matches.
     * @returns Zero.
     */
    const noMatches = (): Promise<number> => Promise.resolve(0);
    /**
     * Record the selector and report no matches.
     * @param selector - Selector under test.
     * @returns Locator stand-in reporting zero matches.
     */
    const spyLocator = (selector: string): { count: () => Promise<number> } => {
      asked.push(selector);
      return { count: noMatches };
    };
    await isErrorDocument({ locator: spyLocator });
    expect(asked).toEqual([ERROR_HEADING_SELECTOR]);
  });
});

// Playwright dispatches `queryCount` with its no-timeout sentinel, so
// the call inherits no page or context deadline. A renderer that stops
// answering after `domcontentloaded` would otherwise wedge INIT for
// every browser bank, and no `catch` can rescue a promise that never
// rejects — only a deadline can.
describe('isErrorDocument — unbounded driver', () => {
  beforeEach((): boolean => {
    jest.useFakeTimers();
    return true;
  });

  afterEach((): boolean => {
    jest.useRealTimers();
    return true;
  });

  /**
   * Build a source whose count settles only via the supplied promise.
   * @param pending - Promise the stand-in's count returns.
   * @returns Source returning that promise for any selector.
   */
  function makeSourceFrom(pending: Promise<number>): ILandingDocumentSource {
    /**
     * Hand back the pending count.
     * @returns The pending count promise.
     */
    const count = (): Promise<number> => pending;
    /**
     * Hand back a locator stand-in over the pending count.
     * @returns Locator stand-in.
     */
    const makeLocator = (): ILandingLocator => ({ count });
    return { locator: makeLocator };
  }

  it('gives up and stays silent when the count never settles', async () => {
    const never = new Promise<number>((): boolean => true);
    const source = makeSourceFrom(never);
    const verdict = isErrorDocument(source);
    await jest.advanceTimersByTimeAsync(ERROR_HEADING_COUNT_TIMEOUT_MS);
    await expect(verdict).resolves.toBe(false);
  });

  // The abandoned count is still live after the deadline. When the page
  // is closed during teardown it rejects, and an unobserved rejection
  // can take the whole process down.
  it('survives the abandoned count rejecting after the deadline', async () => {
    const seen: unknown[] = [];
    /**
     * Record an unhandled rejection so the assertion can see it.
     * @param reason - Rejection reason Node reported.
     * @returns Number of rejections recorded so far.
     */
    const onUnhandled = (reason: unknown): number => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const slot: IRejectSlot = {};
    const pending = pendingCount(slot);
    const source = makeSourceFrom(pending);
    const verdict = isErrorDocument(source);
    await jest.advanceTimersByTimeAsync(ERROR_HEADING_COUNT_TIMEOUT_MS);
    await expect(verdict).resolves.toBe(false);
    const closed = new ScraperError('Target page, context or browser has been closed');
    slot.fire?.(closed);
    await jest.advanceTimersByTimeAsync(0);
    process.off('unhandledRejection', onUnhandled);
    expect(seen).toEqual([]);
  });
});

describe('errorDocumentMessage', () => {
  // Attribution is the whole point: the previous message ("no login nav
  // link found") was accurate and cost a forensic download to explain.
  it('names the URL so the failure points at a document', () => {
    const message = errorDocumentMessage('https://bank.example');
    expect(message).toContain('https://bank.example');
  });

  // Front-loaded for two consumers: the reducer matches on it to
  // suppress the retry pulse, and the stage logger truncates to 30
  // characters, so a trailing code would not survive into the log.
  it('leads with the stable code the reducer matches on', () => {
    const message = errorDocumentMessage('https://bank.example');
    const isLeadingWithCode = message.startsWith(INIT_ERROR_DOCUMENT_CODE);
    expect(isLeadingWithCode).toBe(true);
  });

  it('says the document is an error page, not that an element is missing', () => {
    const message = errorDocumentMessage('https://bank.example');
    expect(message).toContain('error document');
  });
});
