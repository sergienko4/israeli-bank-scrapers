import { jest } from '@jest/globals';

/** Mock locator for Playwright text-based element queries. */
interface IMockLocator {
  isVisible: jest.Mock;
  waitFor: jest.Mock;
  click: jest.Mock;
  count: jest.Mock;
  first: jest.Mock;
}

/**
 * Create a mock locator that simulates visibility.
 * @param visible - Whether the element should appear visible.
 * @returns A mock locator object.
 */
function createLocator(visible: boolean): IMockLocator {
  const self: IMockLocator = {
    isVisible: jest.fn().mockResolvedValue(visible),
    waitFor: visible
      ? jest.fn().mockResolvedValue(undefined)
      : jest.fn().mockRejectedValue(new Error('timeout')),
    click: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(visible ? 1 : 0),
    first: jest.fn(),
  };
  self.first.mockReturnValue(self);
  return self;
}

/** Map of text → locator for the mock page. */
type LocatorMap = Record<string, IMockLocator>;

/**
 * Build a mock Playwright page with text-based locator routing.
 * @param locators - Map of text patterns to mock locators.
 * @returns A mock page object.
 */
function buildMockPage(locators: LocatorMap): Record<string, jest.Mock> {
  const fallback = createLocator(false);
  return {
    locator: jest.fn((selector: string) => {
      for (const [text, loc] of Object.entries(locators)) {
        if (selector.includes(text)) return loc;
      }
      return fallback;
    }),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    waitForURL: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue('https://www.max.co.il/login'),
    frames: jest.fn().mockReturnValue([]),
    $eval: jest.fn().mockResolvedValue(undefined),
    getByText: jest.fn().mockReturnValue(fallback),
    getByRole: jest.fn().mockReturnValue(fallback),
  };
}

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug:
    /**
     * Debug factory.
     * @returns mock logger
     */
    (): Record<string, jest.Mock> => ({
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  resolveFieldContext: jest.fn(),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.max.co.il'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

const MAX_CONFIG = await import('../../Scrapers/Max/Config/MaxLoginConfig.js');

describe('Max preAction — homepage version detection', () => {
  it('Version B (dropdown): clicks dropdown → waits for /login → password tab', async () => {
    const personalArea = createLocator(true);
    const privateCustomers = createLocator(true);
    const passwordLogin = createLocator(true);
    const page = buildMockPage({
      'כניסה לאיזור האישי': personalArea,
      'לקוחות פרטיים': privateCustomers,
      'כניסה עם סיסמה': passwordLogin,
    });

    const preAction = MAX_CONFIG.MAX_CONFIG.preAction;
    if (!preAction) throw new TypeError('preAction missing');
    await preAction(page as never);

    expect(personalArea.click).toHaveBeenCalled();
    expect(privateCustomers.click).toHaveBeenCalled();
    const expectedPattern = '**/login**';
    const anyObj = expect.any(Object) as Record<string, number>;
    expect(page.waitForURL).toHaveBeenCalledWith(expectedPattern, anyObj);
    expect(passwordLogin.click).toHaveBeenCalled();
    expect(page.waitForSelector).toHaveBeenCalled();
  });

  it('Version A (direct): skips dropdown, no /login wait, goes to password tab', async () => {
    const personalArea = createLocator(true);
    const privateCustomers = createLocator(false);
    const passwordLogin = createLocator(true);
    const page = buildMockPage({
      'כניסה לאיזור האישי': personalArea,
      'לקוחות פרטיים': privateCustomers,
      'כניסה עם סיסמה': passwordLogin,
    });

    const preAction = MAX_CONFIG.MAX_CONFIG.preAction;
    if (!preAction) throw new TypeError('preAction missing');
    await preAction(page as never);

    expect(personalArea.click).toHaveBeenCalled();
    expect(privateCustomers.click).not.toHaveBeenCalled();
    expect(page.waitForURL).not.toHaveBeenCalled();
    expect(passwordLogin.click).toHaveBeenCalled();
    expect(page.waitForSelector).toHaveBeenCalled();
  });

  it('closes popup before starting either version flow', async () => {
    const closeBtn = createLocator(true);
    const page = buildMockPage({
      'כניסה לאיזור האישי': createLocator(true),
      'לקוחות פרטיים': createLocator(false),
      'כניסה עם סיסמה': createLocator(true),
    });
    page.getByRole.mockReturnValue(closeBtn);

    const preAction = MAX_CONFIG.MAX_CONFIG.preAction;
    if (!preAction) throw new TypeError('preAction missing');
    await preAction(page as never);

    expect(closeBtn.click).toHaveBeenCalled();
  });
});
