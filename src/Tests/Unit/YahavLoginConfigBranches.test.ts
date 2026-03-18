/**
 * Branch coverage tests for YahavLoginConfig.ts.
 * Targets: ignoreTimeout (returns false), isDismissVisible (visible → true,
 * throws → false), dismissMessaging (found → click + true, none → false),
 * yahavPostAction (full flow), checkReadiness (password + submit visible),
 * invalidPassword (present/absent), changePassword (present/absent).
 */
import { jest } from '@jest/globals';

import {
  createDebugMock,
  createElementsMock,
  createNavigationMock,
} from '../MockModuleFactories.js';

const ELEM_MOCK = createElementsMock();

jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);
jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ELEM_MOCK);
jest.unstable_mockModule('../../Common/Navigation.js', () =>
  createNavigationMock('https://bank.example.com'),
);

const { YAHAV_CONFIG } = await import('../../Scrapers/Yahav/Config/YahavLoginConfig.js');

/** Mock locator shape returned by getByText/locator. */
interface IMockLocator {
  first: jest.Mock;
}

/**
 * Build a mock locator with configurable isVisible and waitFor.
 * @param isVisible - whether isVisible resolves true
 * @param doesThrow - whether isVisible rejects
 * @returns mock locator
 */
function mockLocator(isVisible = true, doesThrow = false): IMockLocator {
  return {
    first: jest.fn(() => ({
      isVisible: doesThrow
        ? jest.fn().mockRejectedValue(new Error('detached'))
        : jest.fn().mockResolvedValue(isVisible),
      waitFor: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    })),
  };
}

/** Hebrew dismiss button texts (must match production DISMISS_TEXTS). */
const DISMISS_TEXTS = ['סגור', 'הבנתי', 'אישור', 'המשך'];

/**
 * Build a mock page for Yahav login tests.
 * @param dismissVisibleIdx - index of dismiss text to mark as visible (-1 = none)
 * @param doesThrow - whether isVisible throws for all dismiss texts
 * @returns mock Page castable via `as never`
 */
function createYahavPage(
  dismissVisibleIdx = -1,
  doesThrow = false,
): {
  getByText: jest.Mock;
  locator: jest.Mock;
  waitForLoadState: jest.Mock;
} {
  return {
    getByText: jest.fn((text: string) => {
      const idx = DISMISS_TEXTS.indexOf(text);
      if (idx >= 0) return mockLocator(idx === dismissVisibleIdx, doesThrow);
      return mockLocator(true);
    }),
    locator: jest.fn(() => mockLocator()),
    waitForLoadState: jest.fn().mockResolvedValue(undefined),
  };
}

describe('yahavPostAction (YAHAV_CONFIG.postAction)', () => {
  const postAction = YAHAV_CONFIG.postAction;

  it('completes when dismiss text is found and dashboard loads', async () => {
    const page = createYahavPage(0);
    await expect(postAction?.(page as never)).resolves.toBeUndefined();
  });

  it('completes when no dismiss text is visible', async () => {
    const page = createYahavPage(-1);
    await expect(postAction?.(page as never)).resolves.toBeUndefined();
  });

  it('completes when isDismissVisible throws (catch returns false)', async () => {
    const page = createYahavPage(-1, true);
    await expect(postAction?.(page as never)).resolves.toBeUndefined();
  });
});

describe('checkReadiness', () => {
  const checkReadiness = YAHAV_CONFIG.checkReadiness;

  it('resolves when password input and submit button are visible', async () => {
    const page = createYahavPage();
    await expect(checkReadiness?.(page as never)).resolves.toBeUndefined();
  });
});

describe('possibleResults.invalidPassword', () => {
  const checker = YAHAV_CONFIG.possibleResults.invalidPassword?.[0] as
    | ((opts: { page: unknown }) => Promise<boolean>)
    | undefined;

  it('returns true when element is present', async () => {
    ELEM_MOCK.elementPresentOnPage.mockResolvedValueOnce(true);
    const isPresent = await checker?.({ page: {} });
    expect(isPresent).toBe(true);
  });

  it('returns false when element is absent', async () => {
    ELEM_MOCK.elementPresentOnPage.mockResolvedValueOnce(false);
    const isPresent = await checker?.({ page: {} });
    expect(isPresent).toBe(false);
  });

  it('returns false when opts.page is undefined', async () => {
    const isPresent = await checker?.({ page: undefined });
    expect(isPresent).toBe(false);
  });
});

describe('possibleResults.changePassword', () => {
  const checker = YAHAV_CONFIG.possibleResults.changePassword?.[0] as
    | ((opts: { page: unknown }) => Promise<boolean>)
    | undefined;

  it('returns true when element is present', async () => {
    ELEM_MOCK.elementPresentOnPage.mockResolvedValueOnce(true);
    const isPresent = await checker?.({ page: {} });
    expect(isPresent).toBe(true);
  });

  it('returns false when element is absent', async () => {
    ELEM_MOCK.elementPresentOnPage.mockResolvedValueOnce(false);
    const isPresent = await checker?.({ page: {} });
    expect(isPresent).toBe(false);
  });
});
