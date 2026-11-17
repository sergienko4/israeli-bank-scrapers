/**
 * Focused run-stamp formatting tests through the production surface
 * (`nextRunStamp` with an injected clock). The formatter itself is private, so
 * these pin the exact `DD-MM-YYYY_HHMMSScc` output that names an on-disk run
 * folder; the independent oracle lives in `Helpers/RunStampFormat.ts`.
 */

import { jest } from '@jest/globals';

import type * as TraceStampModuleType from '../../../../Scrapers/Pipeline/Types/TraceStamp.js';
import formatRunStamp from '../../../Helpers/RunStampFormat.js';

type TraceStampModule = typeof TraceStampModuleType;

const MODULE_PATH = '../../../../Scrapers/Pipeline/Types/TraceStamp.js';

/**
 * Load a fresh TraceStamp module so its monotonic state starts empty.
 * @returns The typed module exports.
 */
async function loadTraceStamp(): Promise<TraceStampModule> {
  jest.resetModules();
  return (await import(MODULE_PATH)) as TraceStampModule;
}

describe('TraceStamp — run-stamp formatting through nextRunStamp', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it.each([
    {
      name: 'a regular instant with a non-zero centisecond suffix',
      date: new Date(2026, 3, 28, 18, 45, 30, 250),
      expected: '28-04-2026_18453025',
    },
    {
      name: 'single-digit day/month/hour/minute/second/centisecond fields',
      date: new Date(2026, 0, 2, 3, 4, 5, 60),
      expected: '02-01-2026_03040506',
    },
  ])('formats $name', async ({ date, expected }) => {
    const mod = await loadTraceStamp();
    const nowMs = date.getTime();
    const stamp = mod.nextRunStamp(nowMs);
    const oracle = formatRunStamp(date);
    expect(stamp).toBe(expected);
    expect(stamp).toBe(oracle);
  });
});
