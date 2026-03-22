/**
 * Unit tests for VisaCalScraper — buildMonths + getAuth.
 * Pure function tests + page.evaluate mock tests.
 * visaCalFetchData tests are in VisaCalScraperFetch.test.ts.
 */

import moment from 'moment';
import type { Page } from 'playwright-core';

import {
  buildMonths,
  getAuth,
} from '../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalScraper.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Auth JSON stored in sessionStorage. */
const AUTH_JSON = JSON.stringify({ auth: { calConnectToken: 'test-token' } });

/**
 * Create a mock page whose evaluate returns a fixed string.
 * @param evalResult - String returned by page.evaluate.
 * @returns Mock Page.
 */
function makeMockEvalPage(evalResult: string): Page {
  return {
    /**
     * Return fixed eval result.
     * @returns Resolved evalResult.
     */
    evaluate: (): Promise<string> => Promise.resolve(evalResult),
  } as unknown as Page;
}

/**
 * Create a mock page that executes the evaluate callback with JSDOM sessionStorage.
 * @param storage - JSDOM sessionStorage instance.
 * @returns Mock Page.
 */
function makeMockJsdomPage(storage: Storage): Page {
  return {
    /**
     * Execute callback with injected sessionStorage.
     * @param fn - Evaluate callback from getAuth.
     * @returns Callback result using JSDOM sessionStorage.
     */
    evaluate: (fn: () => string): Promise<string> => {
      const orig = globalThis.sessionStorage;
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: storage,
        writable: true,
        configurable: true,
      });
      const val = fn();
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: orig,
        writable: true,
        configurable: true,
      });
      return Promise.resolve(val);
    },
  } as unknown as Page;
}

// ── buildMonths tests ─────────────────────────────────────

describe('buildMonths', () => {
  it.each([
    {
      label: 'mid-month start includes that month',
      start: '2026-03-15',
      futureMonths: 0,
      expectFirst: '2026-03-01',
    },
    {
      label: '1st-of-month start includes that month',
      start: '2026-03-01',
      futureMonths: 0,
      expectFirst: '2026-03-01',
    },
    {
      label: 'last day of month includes that month',
      start: '2026-01-31',
      futureMonths: 0,
      expectFirst: '2026-01-01',
    },
  ] as const)(
    /**
     * Verify first month is always included regardless of day.
     * @param label - Test case description.
     * @param start - ISO date string for start date.
     * @param futureMonths - Extra months ahead.
     * @param expectFirst - Expected first month (start of month ISO).
     */
    '$label',
    ({ start, futureMonths, expectFirst }) => {
      const startMoment = moment(start);
      const result = buildMonths(startMoment, futureMonths);
      const firstFormatted = result[0].format('YYYY-MM-DD');
      expect(firstFormatted).toBe(expectFirst);
    },
  );

  it('returns at least 1 month when start is current month', () => {
    const start = moment().startOf('month');
    const result = buildMonths(start, 0);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('includes future months when requested', () => {
    const start = moment().startOf('month');
    const result = buildMonths(start, 2);
    const lastMonth = result.at(-1);
    const expectedMonth = moment().add(2, 'month').startOf('month');
    const expectedStr = expectedMonth.format('YYYY-MM');
    expect(lastMonth?.format('YYYY-MM')).toBe(expectedStr);
  });

  it('iterates forward from start to end', () => {
    const start = moment('2026-01-15');
    const result = buildMonths(start, 0);
    const months = result.map(m => m.format('YYYY-MM'));
    const now = moment().format('YYYY-MM');
    expect(months[0]).toBe('2026-01');
    expect(months).toContain(now);
    /** Verify ascending order. */
    for (let i = 1; i < months.length; i++) {
      expect(months[i] > months[i - 1]).toBe(true);
    }
  });
});

// ── getAuth tests ─────────────────────────────────────────

describe('getAuth', () => {
  it('fails when sessionStorage has no auth-module', async () => {
    const page = makeMockEvalPage('');
    const result = await getAuth(page);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('succeeds with CALAuthScheme token when auth exists', async () => {
    const page = makeMockEvalPage(AUTH_JSON);
    const result = await getAuth(page);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk) expect(result.value).toBe('CALAuthScheme test-token');
  });

  it('fails when calConnectToken is empty', async () => {
    const noToken = JSON.stringify({ auth: {} });
    const page = makeMockEvalPage(noToken);
    const result = await getAuth(page);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('fails on malformed JSON', async () => {
    const page = makeMockEvalPage('not-json{{{');
    const result = await getAuth(page);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('succeeds via JSDOM with real sessionStorage', async () => {
    const jsdomModule = await import('jsdom');
    const dom = new jsdomModule.JSDOM('<!DOCTYPE html>', { url: 'https://example.com' });
    dom.window.sessionStorage.setItem('auth-module', AUTH_JSON);
    const page = makeMockJsdomPage(dom.window.sessionStorage);
    const result = await getAuth(page);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk) expect(result.value).toBe('CALAuthScheme test-token');
  });

  it('fails when sessionStorage item missing via JSDOM', async () => {
    const jsdomModule = await import('jsdom');
    const dom = new jsdomModule.JSDOM('<!DOCTYPE html>', { url: 'https://example.com' });
    const page = makeMockJsdomPage(dom.window.sessionStorage);
    const result = await getAuth(page);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });
});
