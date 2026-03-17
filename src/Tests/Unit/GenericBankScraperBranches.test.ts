/**
 * Branch coverage tests for GenericBankScraper.
 * Targets: toErrorMessage (non-Error), mapPossibleResults optional branches,
 * scopeFieldConfig with/without anchor, fillFieldWithFallback paths,
 * tryDiscoverFormAnchor error catch, buildSubmitButtonFunction fallback.
 */
import { jest } from '@jest/globals';

import type { ILoginConfig, SelectorCandidate } from '../../Scrapers/Base/Config/LoginConfig.js';
import type { ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import { mockToXpathLiteral } from '../MockModuleFactories.js';

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

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger with all methods stubbed.
   */
  getDebug: (): Record<string, jest.Mock> => ({
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
    fields: [
      { credentialKey: 'username', selectors: [{ kind: 'css', value: '#user' }] },
      { credentialKey: 'password', selectors: [{ kind: 'css', value: '#pass' }] },
    ],
    submit: { kind: 'css', value: '#submit' },
    possibleResults: { success: [SUCCESS_URL] },
    ...overrides,
  };
}

let mockPage: ReturnType<typeof MOCK_MOD.createMockPage>;

beforeEach(() => {
  jest.clearAllMocks();
  mockPage = MOCK_MOD.createMockPage();
  const mockContext = MOCK_MOD.createMockContext(mockPage);
  const mockBrowser = MOCK_MOD.createMockBrowser(mockContext);
  (LAUNCH_MOD.launchCamoufox as jest.Mock).mockResolvedValue(mockBrowser);
  (NAV_MOD.getCurrentUrl as jest.Mock).mockResolvedValue(SUCCESS_URL);
  RESOLVE_FIELD_CONTEXT_MOCK.mockResolvedValue({
    isResolved: true,
    selector: '#user',
    context: mockPage,
  });
  DISCOVER_FORM_ANCHOR_MOCK.mockResolvedValue({
    selector: 'form',
    element: {},
  });
});

describe('GenericBankScraper branch coverage', () => {
  describe('mapPossibleResults optional branches', () => {
    it('includes changePassword when provided', async () => {
      const config = makeConfig({
        possibleResults: {
          success: [SUCCESS_URL],
          changePassword: ['https://bank.example.com/change'],
        },
      });
      const scraper = new SCRAPER_MOD.ConcreteGenericScraper(
        MOCK_MOD.createMockScraperOptions(),
        config,
      );
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });

    it('includes accountBlocked when provided', async () => {
      const config = makeConfig({
        possibleResults: {
          success: [SUCCESS_URL],
          accountBlocked: ['https://bank.example.com/blocked'],
        },
      });
      const scraper = new SCRAPER_MOD.ConcreteGenericScraper(
        MOCK_MOD.createMockScraperOptions(),
        config,
      );
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });

    it('includes unknownError when provided', async () => {
      const config = makeConfig({
        possibleResults: {
          success: [SUCCESS_URL],
          unknownError: ['https://bank.example.com/error'],
        },
      });
      const scraper = new SCRAPER_MOD.ConcreteGenericScraper(
        MOCK_MOD.createMockScraperOptions(),
        config,
      );
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });
  });

  describe('fillFieldWithFallback — resolver unresolved path', () => {
    it('uses CSS fallback when resolver returns unresolved', async () => {
      RESOLVE_FIELD_CONTEXT_MOCK.mockResolvedValue({
        isResolved: false,
        selector: '',
        context: mockPage,
      });
      const scraper = new SCRAPER_MOD.ConcreteGenericScraper(
        MOCK_MOD.createMockScraperOptions(),
        makeConfig(),
      );
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      expect(FILL_INPUT_SPY).toHaveBeenCalled();
    });
  });

  describe('tryDiscoverFormAnchor — error path', () => {
    it('catches form anchor discovery error and continues', async () => {
      DISCOVER_FORM_ANCHOR_MOCK.mockRejectedValue('string error thrown');
      const scraper = new SCRAPER_MOD.ConcreteGenericScraper(
        MOCK_MOD.createMockScraperOptions(),
        makeConfig(),
      );
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });
  });

  describe('buildSubmitButtonFunction — fallback path', () => {
    it('uses fallback CSS when submit resolver returns unresolved', async () => {
      RESOLVE_FIELD_CONTEXT_MOCK.mockResolvedValue({
        isResolved: false,
        selector: '',
        context: mockPage,
      });
      const scraper = new SCRAPER_MOD.ConcreteGenericScraper(
        MOCK_MOD.createMockScraperOptions(),
        makeConfig(),
      );
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      expect(CLICK_BUTTON_SPY).toHaveBeenCalled();
    });
  });

  describe('checkReadiness callback', () => {
    it('invokes checkReadiness when provided in config', async () => {
      const readinessSpy = jest.fn().mockResolvedValue(undefined);
      const config = makeConfig({ checkReadiness: readinessSpy });
      const scraper = new SCRAPER_MOD.ConcreteGenericScraper(
        MOCK_MOD.createMockScraperOptions(),
        config,
      );
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      expect(readinessSpy).toHaveBeenCalled();
    });
  });

  describe('buildFieldList — empty selectors', () => {
    it('uses empty string selector when field has no selectors', async () => {
      const config = makeConfig({
        fields: [{ credentialKey: 'username', selectors: [] }],
      });
      RESOLVE_FIELD_CONTEXT_MOCK.mockResolvedValue({
        isResolved: false,
        selector: '',
        context: mockPage,
      });
      const scraper = new SCRAPER_MOD.ConcreteGenericScraper(
        MOCK_MOD.createMockScraperOptions(),
        config,
      );
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });
  });

  describe('scopeFieldConfig — wellKnown fallback with form anchor', () => {
    it('injects wellKnown candidates when bank selectors empty and form anchor exists', async () => {
      const config = makeConfig({
        fields: [
          { credentialKey: 'username', selectors: [{ kind: 'css', value: '#user' }] },
          { credentialKey: 'password', selectors: [] },
        ],
      });
      RESOLVE_FIELD_CONTEXT_MOCK.mockResolvedValue({
        isResolved: true,
        selector: '#user',
        context: mockPage,
      });
      DISCOVER_FORM_ANCHOR_MOCK.mockResolvedValue({ selector: 'form#login', context: mockPage });
      const scraper = new SCRAPER_MOD.ConcreteGenericScraper(
        MOCK_MOD.createMockScraperOptions(),
        config,
      );
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      const scopeCall = SCOPE_CANDIDATES_MOCK.mock.calls.find(
        (call: [string, SelectorCandidate[]]) => call[0] === 'form#login',
      ) as [string, SelectorCandidate[]] | undefined;
      expect(scopeCall).toBeDefined();
      const scopedCandidates = scopeCall?.[1] ?? [];
      const hasLabelText = scopedCandidates.some(
        c => c.kind === 'labelText' && c.value === 'סיסמה',
      );
      expect(hasLabelText).toBe(true);
    });
  });
});
