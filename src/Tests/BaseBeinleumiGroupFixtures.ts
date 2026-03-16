import { jest } from '@jest/globals';

import { type IMockPage, type MockOverrides } from './MockPage.js';

export const NO_DATA_TEXT =
  '\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D5 \u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D1\u05E0\u05D5\u05E9\u05D0 \u05D4\u05DE\u05D1\u05D5\u05E7\u05E9';

export const COMPLETED_COL = [
  { colClass: 'date first', index: 0 },
  { colClass: 'reference wrap_normal', index: 1 },
  { colClass: 'details', index: 2 },
  { colClass: 'debit', index: 3 },
  { colClass: 'credit', index: 4 },
];

export const PENDING_COL = [
  { colClass: 'first date', index: 0 },
  { colClass: 'details wrap_normal', index: 1 },
  { colClass: 'details', index: 2 },
  { colClass: 'debit', index: 3 },
  { colClass: 'credit', index: 4 },
];

/**
 * Resolve innerText by selector for locator mock.
 * @param selector - CSS selector string.
 * @returns mocked inner text for the matched element.
 */
function textBySelector(selector: string): string {
  if (selector === 'div.fibi_account span.acc_num') return '12/345678';
  if (selector === '.main_balance') return '\u20AA5,000.00';
  if (selector === '.NO_DATA') return NO_DATA_TEXT;
  return '';
}

/**
 * Create a mock that resolves to the given value.
 * @param v - value to resolve.
 * @returns mocked function.
 */
function resolved(v?: unknown): jest.Mock {
  return jest.fn().mockResolvedValue(v);
}

/**
 * Build the inner element stub for a locator first().
 * @param text - resolved innerText value.
 * @returns inner element mock with standard stubs.
 */
function buildInnerElement(text: string): Record<string, jest.Mock> {
  return {
    fill: resolved(),
    click: resolved(),
    isVisible: jest.fn().mockResolvedValue(true),
    waitFor: resolved(),
    count: jest.fn().mockResolvedValue(1),
    evaluate: resolved(),
    getAttribute: jest.fn().mockResolvedValue(null),
    innerText: jest.fn().mockResolvedValue(text),
  };
}

/**
 * Build a locator mock that returns innerText based on selector.
 * @param selector - The CSS selector for context.
 * @returns Mock locator chain with first().innerText().
 */
export function buildLocator(selector: string): Record<string, jest.Mock> {
  const selectorText = textBySelector(selector);
  const inner = buildInnerElement(selectorText);
  return {
    first: jest.fn().mockReturnValue(inner),
    count: jest.fn().mockResolvedValue(0),
    evaluateAll: resolved([]),
    allInnerTexts: resolved([]),
    all: resolved([]),
  };
}

/**
 * Create a page mock with standard account selectors.
 * @param createMockPage - factory to create a mock page.
 * @param overrides - Mock overrides for the page.
 * @returns Mocked page.
 */
export function createBeinleumiPage(
  createMockPage: (o: MockOverrides) => IMockPage,
  overrides: MockOverrides = {},
): IMockPage {
  return createMockPage({
    locator: jest.fn().mockImplementation(buildLocator),
    evaluate: jest.fn().mockResolvedValue([]),
    frames: jest.fn().mockReturnValue([]),
    ...overrides,
  });
}
