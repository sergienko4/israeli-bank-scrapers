/**
 * Branch coverage tests for GenericBankScraper.
 * Targets: toErrorMessage (non-Error), mapPossibleResults optional branches
 * (it.each table-driven), scopeFieldConfig with/without anchor and wellKnown
 * fallback, fillFieldWithFallback paths, tryDiscoverFormAnchor error catch,
 * buildSubmitButtonFunction fallback, checkReadiness callback,
 * buildFieldList empty selectors.
 */
import { jest } from '@jest/globals';

import type { ILoginConfig, SelectorCandidate } from '../../Scrapers/Base/Config/LoginConfig.js';
import type { ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import { createDebugMock, mockToXpathLiteral } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({
  launchCamoufox: jest.fn(),
}));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://bank.example.com/dashboard'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

const FILL_INPUT_SPY = jest.fn().mockResolvedValue(undefined);
const CLICK_BUTTON_SPY = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: CLICK_BUTTON_SPY,
  fillInput: FILL_INPUT_SPY,
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

const RESOLVE_FIELD_CONTEXT_MOCK = jest.fn();
const CANDIDATE_TO_CSS_MOCK = jest.fn((candidate: SelectorCandidate) => candidate.value);

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  resolveFieldWithCache: jest
    .fn()
    .mockResolvedValue({ isResolved: false, selector: '', context: {} }),
  resolveFieldContext: RESOLVE_FIELD_CONTEXT_MOCK,
  candidateToCss: CANDIDATE_TO_CSS_MOCK,
  getWellKnownCandidates: jest.fn().mockReturnValue([{ kind: 'labelText', value: 'סיסמה' }]),
  tryInContext: jest.fn().mockResolvedValue(null),
  toXpathLiteral: mockToXpathLiteral,
  extractCredentialKey: jest.fn((selector: string) => selector),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

const DISCOVER_FORM_ANCHOR_MOCK = jest.fn();
const SCOPE_CANDIDATES_MOCK = jest.fn((_sel: string, cands: SelectorCandidate[]) => cands);

jest.unstable_mockModule('../../Common/FormAnchor.js', () => ({
  discoverFormAnchor: DISCOVER_FORM_ANCHOR_MOCK,
  scopeCandidates: SCOPE_CANDIDATES_MOCK,
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  /**
   * Execute actions sequentially like the real runSerial.
   * @param actions - Array of async action factories.
   * @returns Array of action results.
   */
  runSerial: jest.fn().mockImplementation(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const seed = Promise.resolve([] as T[]);
    return actions.reduce(
      (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
      seed,
    );
  }),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

const LAUNCH_MOD = await import('../../Common/CamoufoxLauncher.js');
const NAV_MOD = await import('../../Common/Navigation.js');
const SCRAPER_MOD = await import('../../Scrapers/Base/ConcreteGenericScraper.js');
const MOCK_MOD = await import('../MockPage.js');

const SUCCESS_URL = 'https://bank.example.com/dashboard';
const CREDS: ScraperCredentials = { username: 'u', password: 'p' };

/**
 * Build a default login config with overrides.
 * @param overrides - Partial login config overrides.
 * @returns A complete ILoginConfig.
 */
function makeConfig(overrides: Partial<ILoginConfig> = {}): ILoginConfig {
  return {
    loginUrl: 'https://bank.example.com/login',
    fields: makeDefaultFields(),
    submit: { kind: 'css', value: '#submit' },
    possibleResults: { success: [SUCCESS_URL] },
    ...overrides,
  };
}

/**
 * Build default field config with username and password.
 * @returns field array for login config.
 */
function makeDefaultFields(): ILoginConfig['fields'] {
  return [
    { credentialKey: 'username', selectors: [{ kind: 'css', value: '#user' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#pass' }] },
  ];
}

/**
 * Build a new scraper instance with default config + overrides.
 * @param configOverrides - partial login config fields to override.
 * @returns scraper instance ready for testing.
 */
function buildScraper(
  configOverrides: Partial<ILoginConfig> = {},
): InstanceType<typeof SCRAPER_MOD.ConcreteGenericScraper> {
  return new SCRAPER_MOD.ConcreteGenericScraper(
    MOCK_MOD.createMockScraperOptions(),
    makeConfig(configOverrides),
  );
}

/**
 * Set up standard resolved mock state for field context.
 * @returns true when mock is configured.
 */
function mockResolvedField(): boolean {
  RESOLVE_FIELD_CONTEXT_MOCK.mockResolvedValue({
    isResolved: true,
    selector: '#user',
    context: mockPage,
  });
  return true;
}

/**
 * Set up unresolved mock state for field context.
 * @returns true when mock is configured.
 */
function mockUnresolvedField(): boolean {
  RESOLVE_FIELD_CONTEXT_MOCK.mockResolvedValue({
    isResolved: false,
    selector: '',
    context: mockPage,
  });
  return true;
}

/**
 * Set up form anchor mock with given selector.
 * @param selector - CSS selector for form anchor.
 * @returns true when mock is configured.
 */
function mockFormAnchor(selector: string): boolean {
  DISCOVER_FORM_ANCHOR_MOCK.mockResolvedValue({
    selector,
    context: mockPage,
  });
  return true;
}

let mockPage: ReturnType<typeof MOCK_MOD.createMockPage>;

beforeEach(() => {
  jest.clearAllMocks();
  mockPage = MOCK_MOD.createMockPage();
  const mockContext = MOCK_MOD.createMockContext(mockPage);
  const mockBrowser = MOCK_MOD.createMockBrowser(mockContext);
  (LAUNCH_MOD.launchCamoufox as jest.Mock).mockResolvedValue(mockBrowser);
  (NAV_MOD.getCurrentUrl as jest.Mock).mockResolvedValue(SUCCESS_URL);
  mockResolvedField();
  mockFormAnchor('form');
});

describe('GenericBankScraper branch coverage', () => {
  describe('mapPossibleResults optional branches', () => {
    const optionalResultCases = [
      ['changePassword', 'https://bank.example.com/change'],
      ['accountBlocked', 'https://bank.example.com/blocked'],
      ['unknownError', 'https://bank.example.com/error'],
    ] as const;

    it.each(optionalResultCases)('includes %s when provided', async (key, url) => {
      const scraper = buildScraper({
        possibleResults: { success: [SUCCESS_URL], [key]: [url] },
      });
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });
  });

  describe('fillFieldWithFallback — resolver unresolved path', () => {
    it('uses CSS fallback when resolver returns unresolved', async () => {
      mockUnresolvedField();
      const scraper = buildScraper();
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      expect(FILL_INPUT_SPY).toHaveBeenCalled();
    });
  });

  describe('tryDiscoverFormAnchor — error path', () => {
    it('catches form anchor discovery error and continues', async () => {
      DISCOVER_FORM_ANCHOR_MOCK.mockRejectedValue('string error thrown');
      const scraper = buildScraper();
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });
  });

  describe('buildSubmitButtonFunction — fallback path', () => {
    it('uses fallback CSS when submit resolver is unresolved', async () => {
      mockUnresolvedField();
      const scraper = buildScraper();
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      expect(CLICK_BUTTON_SPY).toHaveBeenCalled();
    });
  });

  describe('checkReadiness callback', () => {
    it('invokes checkReadiness when provided in config', async () => {
      const readinessSpy = jest.fn().mockResolvedValue(undefined);
      const scraper = buildScraper({ checkReadiness: readinessSpy });
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      expect(readinessSpy).toHaveBeenCalled();
    });
  });

  describe('buildFieldList — empty selectors', () => {
    it('uses empty string selector when field has no selectors', async () => {
      mockUnresolvedField();
      const scraper = buildScraper({
        fields: [{ credentialKey: 'username', selectors: [] }],
      });
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });
  });

  describe('scopeFieldConfig — wellKnown fallback with form anchor', () => {
    it('injects wellKnown candidates when bank selectors empty', async () => {
      mockResolvedField();
      mockFormAnchor('form#login');
      const scraper = buildScraper({
        fields: [
          { credentialKey: 'username', selectors: [{ kind: 'css', value: '#user' }] },
          { credentialKey: 'password', selectors: [] },
        ],
      });
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      assertWellKnownScoped('form#login');
    });

    it('scopes non-empty wellKnown candidates through form anchor', async () => {
      mockResolvedField();
      mockFormAnchor('form#main');
      const scraper = buildScraper({
        fields: [
          { credentialKey: 'username', selectors: [] },
          { credentialKey: 'password', selectors: [] },
        ],
      });
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      assertWellKnownScoped('form#main');
    });
  });
});

/**
 * Assert that scopeCandidates was called with wellKnown labelText
 * candidates scoped to the given form selector.
 * @param formSelector - Expected form CSS selector.
 * @returns true when all assertions pass.
 */
function assertWellKnownScoped(formSelector: string): boolean {
  const allCalls = SCOPE_CANDIDATES_MOCK.mock.calls as [string, SelectorCandidate[]][];
  const formCalls = allCalls.filter(c => c[0] === formSelector);
  expect(formCalls.length).toBeGreaterThan(0);
  const allCandidates = formCalls.flatMap(c => c[1]);
  const hasLabel = allCandidates.some(c => c.kind === 'labelText' && c.value === 'סיסמה');
  expect(hasLabel).toBe(true);
  return true;
}
