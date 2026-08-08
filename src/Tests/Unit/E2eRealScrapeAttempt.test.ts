/**
 * Unit tests for the shared OTP-bank scrape-attempt factory.
 *
 * <p>Pepper, OneZero and PayBox drive the same warm-then-cold fallback, so
 * their attempt runners were byte-identical apart from the bank id. Folding
 * them into one factory removes that duplication but concentrates the risk:
 * a drift here breaks all three real-bank suites at once, and re-proving
 * those against live banks costs a human-entered OTP. These tests pin the
 * contract — correct options, and a FRESH scraper per attempt so a failed
 * warm attempt cannot leak session state into the cold retry.
 *
 * `createScraper` is mocked, so no browser starts and no network call runs.
 */

import { jest } from '@jest/globals';

/** Options recorded from a `createScraper` call. */
type RecordedOptions = Record<string, unknown>;

/** Attempt callback erased to the shape these tests drive. */
type AnyAttempt = (creds: unknown) => Promise<unknown>;

const CREATE_SCRAPER_MOCK = jest.fn();
const SCRAPE_MOCK = jest.fn();

jest.unstable_mockModule('../../index.js', () => ({
  CompanyTypes: { Pepper: 'pepper', OneZero: 'oneZero', PayBox: 'payBox' },
  createScraper: CREATE_SCRAPER_MOCK,
}));

const { createScrapeAttempt: CREATE_SCRAPE_ATTEMPT } = await import('../E2eReal/ScrapeAttempt.js');
const { BROWSER_ARGS } = await import('../E2eReal/Helpers.js');

/**
 * Read the options handed to `createScraper` on a given call.
 * @param call - Zero-based call index.
 * @returns Options recorded for that call.
 */
function optionsOf(call: number): RecordedOptions {
  const calls = CREATE_SCRAPER_MOCK.mock.calls as unknown as RecordedOptions[][];
  return calls[call][0];
}

/**
 * Build a writer double that records nothing.
 * @returns Writer resolving immediately.
 */
function stubWriter(): () => Promise<void> {
  return jest.fn(() => Promise.resolve());
}

/**
 * Build an attempt bound to an observable auth-flow writer.
 * @param writer - Writer to bind as `onAuthFlowComplete`.
 * @returns Attempt callback under test.
 */
function buildAttempt(writer: () => Promise<void>): AnyAttempt {
  const args = { companyId: 'pepper', onAuthFlowComplete: writer };
  return CREATE_SCRAPE_ATTEMPT(args as never) as unknown as AnyAttempt;
}

describe('E2eReal/ScrapeAttempt', () => {
  beforeEach(() => {
    CREATE_SCRAPER_MOCK.mockReset();
    SCRAPE_MOCK.mockReset();
    CREATE_SCRAPER_MOCK.mockImplementation(() => ({ scrape: SCRAPE_MOCK }));
    SCRAPE_MOCK.mockImplementation(() => Promise.resolve({ success: true }));
  });

  it('does not build a scraper until the attempt is invoked', () => {
    const writer = stubWriter();

    buildAttempt(writer);

    expect(CREATE_SCRAPER_MOCK).not.toHaveBeenCalled();
  });

  it('passes the configured bank and cache writer to the scraper', async () => {
    const writer = stubWriter();
    const attempt = buildAttempt(writer);

    await attempt({});

    expect(optionsOf(0).companyId).toBe('pepper');
    expect(optionsOf(0).onAuthFlowComplete).toBe(writer);
  });

  it('runs headless with the shared browser arguments', async () => {
    const writer = stubWriter();
    const attempt = buildAttempt(writer);

    await attempt({});

    expect(optionsOf(0).shouldShowBrowser).toBe(false);
    expect(optionsOf(0).args).toBe(BROWSER_ARGS);
    expect(optionsOf(0).startDate).toBeInstanceOf(Date);
  });

  it('builds a FRESH scraper for every attempt so warm state cannot leak', async () => {
    const writer = stubWriter();
    const attempt = buildAttempt(writer);

    await attempt({});
    await attempt({});

    expect(CREATE_SCRAPER_MOCK).toHaveBeenCalledTimes(2);
  });

  it('forwards the supplied credentials and returns the scrape result', async () => {
    const creds = { phoneNumber: '050' };
    SCRAPE_MOCK.mockImplementation(() => Promise.resolve({ success: false }));
    const writer = stubWriter();
    const attempt = buildAttempt(writer);

    const result = await attempt(creds);

    expect(SCRAPE_MOCK).toHaveBeenCalledWith(creds);
    expect(result).toEqual({ success: false });
  });
});
