/**
 * Branch coverage tests for YahavDatePicker.ts.
 * Targets: tryClickGridCell (match → click, no match → false),
 * buildGridActions (isClicked short-circuit), selectYearFromGrid,
 * selectDayFromGrid, searchByDates (year not found → false,
 * full success path → true).
 */
import { jest } from '@jest/globals';
import moment from 'moment';

import type { IYahavDateSelectors } from '../../Scrapers/Yahav/YahavDatePicker.js';
import { createElementsMock, createWaitingMock } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/ElementsInteractions.js', createElementsMock);
jest.unstable_mockModule('../../Common/Waiting.js', createWaitingMock);

const MOD = await import('../../Scrapers/Yahav/YahavDatePicker.js');

const SEL: IYahavDateSelectors = {
  datePickerOpener: '.opener',
  daysGridCheck: '.daysCheck',
  daysGridPrefix: '.days',
  monthPickerBtn: '.monthBtn',
  monthsGridCheck: '.monthsCheck',
  monthsGridPrefix: '.months',
  yearsGridCheck: '.yearsCheck',
  yearsGridPrefix: '.years',
};

/** Mock locator with innerText lookup by selector. */
interface IMockLocator {
  first: jest.Mock;
}

/**
 * Build a mock page whose locator().first().innerText() returns values from a map.
 * @param textMap - selector to innerText mapping
 * @returns mock Page castable via `as never`
 */
function createMockPage(textMap: Map<string, string>): { locator: jest.Mock } {
  return {
    locator: jest.fn(
      (sel: string): IMockLocator => ({
        first: jest.fn(() => ({
          innerText: jest.fn(() => Promise.resolve(textMap.get(sel) ?? '')),
        })),
      }),
    ),
  };
}

describe('searchByDates', () => {
  const jan15 = moment('2025-01-15');
  const mar01 = moment('2025-03-01');

  it('returns false when year is not found in grid', async () => {
    const page = createMockPage(new Map());
    const isFound = await MOD.default(page as never, jan15, SEL);
    expect(isFound).toBe(false);
  });

  it('returns true when year, month, and day are all found', async () => {
    const textMap = new Map<string, string>();
    textMap.set('.years > div:nth-child(3)', '2025');
    textMap.set('.days > div:nth-child(5)', '15');
    const page = createMockPage(textMap);

    const isFound = await MOD.default(page as never, jan15, SEL);
    expect(isFound).toBe(true);
  });

  it('covers tryClickGridCell no-match then match (isClicked short-circuit)', async () => {
    const textMap = new Map<string, string>();
    textMap.set('.years > div:nth-child(2)', '2024');
    textMap.set('.years > div:nth-child(3)', '2025');
    textMap.set('.days > div:nth-child(1)', '1');
    const page = createMockPage(textMap);

    const isFound = await MOD.default(page as never, mar01, SEL);
    expect(isFound).toBe(true);
  });
});
