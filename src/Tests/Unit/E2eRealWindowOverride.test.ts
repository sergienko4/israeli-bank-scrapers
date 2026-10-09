/**
 * E2E window override (`<BANK>_E2E_DAYS_BACK`) — the unset default, the
 * accepted range, and the refusals that keep a typo from costing a login.
 */

import { jest } from '@jest/globals';

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import { type IDaysBackOverride, overridableStartDate } from '../E2eReal/WindowOverride.js';

const NOW = new Date('2026-10-08T09:00:00.000Z');
const OVERRIDE: IDaysBackOverride = { envName: 'TEST_E2E_DAYS_BACK', maxDays: 365 };

/**
 * The start the override yields in one environment, as an ISO instant.
 * @param env - Environment holding (or not) the override variable.
 * @returns Start instant.
 */
function startIn(env: Readonly<Record<string, string>>): string {
  const start = overridableStartDate(OVERRIDE, env);
  return start.toISOString();
}

/**
 * A deferred read of the override for one variable value.
 * @param value - The variable's value.
 * @returns Thunk that reads the start.
 */
function readerOf(value: string): () => string {
  return (): string => startIn({ TEST_E2E_DAYS_BACK: value });
}

describe('overridableStartDate', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('falls back to the 180-day default when the variable is unset', () => {
    const start = startIn({});
    expect(start).toBe('2026-04-11T09:00:00.000Z');
  });

  it('falls back to the 180-day default when the variable is empty', () => {
    const start = startIn({ TEST_E2E_DAYS_BACK: '' });
    expect(start).toBe('2026-04-11T09:00:00.000Z');
  });

  it.each([
    ['1', '2026-10-07T09:00:00.000Z'],
    ['30', '2026-09-08T09:00:00.000Z'],
    ['365', '2025-10-08T09:00:00.000Z'],
  ])('starts %p whole days back', (value, expected) => {
    const start = startIn({ TEST_E2E_DAYS_BACK: value });
    expect(start).toBe(expected);
  });

  it.each(['0', '366', '30.5', '-30', ' 30', '30d', 'abc'])('refuses %p', value => {
    const read = readerOf(value);
    expect(read).toThrow(ScraperError);
    expect(read).toThrow('TEST_E2E_DAYS_BACK must be a whole number of days from 1 to 365');
  });
});
