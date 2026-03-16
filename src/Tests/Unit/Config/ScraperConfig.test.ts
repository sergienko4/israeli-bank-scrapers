import { jest } from '@jest/globals';

import type { SelectorCandidate } from '../../../Scrapers/Base/Config/LoginConfig.js';
import { mockToXpathLiteral } from '../../MockModuleFactories.js';

// ── Mocks (required by transitive imports from ILoginConfig files) ────────────

jest.unstable_mockModule('../../../Common/Debug.js', () => ({
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

jest.unstable_mockModule('../../../Common/ElementsInteractions.js', () => ({
  waitUntilElementFound: jest.fn(),
  waitUntilElementDisappear: jest.fn(),
  clickButton: jest.fn(),
  clickLink: jest.fn(),
  dropdownElements: jest.fn(),
  dropdownSelect: jest.fn(),
  fillInput: jest.fn(),
  elementPresentOnPage: jest.fn(),
  waitUntilIframeFound: jest.fn(),
  pageEval: jest.fn(),
  pageEvalAll: jest.fn(),
  setValue: jest.fn(),
  capturePageText: jest.fn(),
}));

jest.unstable_mockModule('../../../Common/Navigation.js', () => ({
  waitForNavigation: jest.fn(),
  waitForRedirect: jest.fn(),
  getCurrentUrl: jest.fn(),
  waitForUrl: jest.fn(),
  waitForNavigationAndDomLoad: jest.fn(),
}));

jest.unstable_mockModule('../../../Common/Waiting.js', () => ({
  sleep: jest.fn(),
  humanDelay: jest.fn(),
  waitUntil: jest.fn(),
  raceTimeout: jest.fn(),
  runSerial: jest.fn(),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../../Common/SelectorResolver.js', () => ({
  resolveFieldContext: jest.fn(),
  resolveFieldWithCache: jest.fn(),
  candidateToCss: jest.fn(),
  extractCredentialKey: jest.fn(),
  tryInContext: jest.fn(),
  toXpathLiteral: mockToXpathLiteral,
  resolveDashboardField: jest.fn(),
}));

jest.unstable_mockModule('../../../Common/Storage.js', () => ({
  getFromSessionStorage: jest.fn(),
}));

jest.unstable_mockModule('../../../Common/Fetch.js', () => ({
  fetchPost: jest.fn(),
  fetchPostWithinPage: jest.fn(),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

const { SCRAPER_CONFIGURATION } =
  await import('../../../Scrapers/Registry/Config/ScraperConfig.js');
const { BANK_REGISTRY } = await import('../../../Scrapers/Registry/BankRegistry.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

const VALID_KINDS = [
  'labelText',
  'textContent',
  'css',
  'placeholder',
  'ariaLabel',
  'name',
  'xpath',
] as const;

const WELL_KNOWN = SCRAPER_CONFIGURATION.wellKnownSelectors;
type WkKey = keyof typeof WELL_KNOWN;

/**
 * Returns credential keys that have at least one CSS selector candidate.
 * @returns array of credential key strings containing css candidates.
 */
function keysWithCss(): string[] {
  return Object.keys(WELL_KNOWN).filter(key =>
    (WELL_KNOWN[key as WkKey] as readonly SelectorCandidate[]).some(
      candidate => candidate.kind === 'css',
    ),
  );
}

/**
 * Returns the last index of a given kind in a candidate array.
 * @param arr - array of selector candidates.
 * @param kind - the kind string to search for.
 * @returns last index of the kind, or -1 if not found.
 */
function lastIndexOfKind(arr: readonly SelectorCandidate[], kind: string): number {
  return arr.reduce((acc, candidate, index) => (candidate.kind === kind ? index : acc), -1);
}

/**
 * Returns the first index of a given kind in a candidate array.
 * @param arr - array of selector candidates.
 * @param kind - the kind string to search for.
 * @returns first index of the kind, or -1 if not found.
 */
function firstIndexOfKind(arr: readonly SelectorCandidate[], kind: string): number {
  return arr.findIndex(candidate => candidate.kind === kind);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('wellKnownSelectors', () => {
  const cssKeys = keysWithCss();

  describe('ordering invariant — visible-text kinds before css', () => {
    it.each(cssKeys)('%s: all labelText entries before all css entries', key => {
      const arr = WELL_KNOWN[key as WkKey] as readonly SelectorCandidate[];
      const lastLabel = lastIndexOfKind(arr, 'labelText');
      const firstCss = firstIndexOfKind(arr, 'css');
      if (lastLabel >= 0 && firstCss >= 0) {
        expect(lastLabel).toBeLessThan(firstCss);
      }
    });

    it.each(cssKeys)('%s: all placeholder entries before all css entries', key => {
      const arr = WELL_KNOWN[key as WkKey] as readonly SelectorCandidate[];
      const lastPlaceholder = lastIndexOfKind(arr, 'placeholder');
      const firstCss = firstIndexOfKind(arr, 'css');
      if (lastPlaceholder >= 0 && firstCss >= 0) {
        expect(lastPlaceholder).toBeLessThan(firstCss);
      }
    });

    it.each(cssKeys)('%s: all ariaLabel entries before all css entries', key => {
      const arr = WELL_KNOWN[key as WkKey] as readonly SelectorCandidate[];
      const lastAria = lastIndexOfKind(arr, 'ariaLabel');
      const firstCss = firstIndexOfKind(arr, 'css');
      if (lastAria >= 0 && firstCss >= 0) {
        expect(lastAria).toBeLessThan(firstCss);
      }
    });
  });

  describe('each credential key has at least one labelText', () => {
    const credentialKeys: WkKey[] = ['username', 'userCode', 'password', 'id', 'nationalID', 'num'];

    it.each(credentialKeys)('%s has at least one labelText candidate', key => {
      const arr = WELL_KNOWN[key] as readonly SelectorCandidate[];
      const hasLabel = arr.some(candidate => candidate.kind === 'labelText');
      expect(hasLabel).toBe(true);
    });
  });

  describe('specific bank CSS present', () => {
    it('Mizrahi: #userNumberDesktopHeb in username', () => {
      const arr = WELL_KNOWN.username as readonly SelectorCandidate[];
      expect(arr).toContainEqual({ kind: 'css', value: '#userNumberDesktopHeb' });
    });

    it('Mizrahi: #passwordDesktopHeb in password', () => {
      const arr = WELL_KNOWN.password as readonly SelectorCandidate[];
      expect(arr).toContainEqual({ kind: 'css', value: '#passwordDesktopHeb' });
    });

    it('Max: #user-name in username', () => {
      const arr = WELL_KNOWN.username as readonly SelectorCandidate[];
      expect(arr).toContainEqual({ kind: 'css', value: '#user-name' });
    });

    it('__submit__ has button[type="submit"]', () => {
      const arr = WELL_KNOWN.__submit__ as readonly SelectorCandidate[];
      expect(arr).toContainEqual({ kind: 'css', value: 'button[type="submit"]' });
    });
  });

  it('__submit__ has ariaLabel before css', () => {
    const arr = WELL_KNOWN.__submit__ as readonly SelectorCandidate[];
    const lastAria = lastIndexOfKind(arr, 'ariaLabel');
    const firstCss = firstIndexOfKind(arr, 'css');
    expect(lastAria).toBeGreaterThanOrEqual(0);
    expect(firstCss).toBeGreaterThanOrEqual(0);
    expect(lastAria).toBeLessThan(firstCss);
  });

  describe('all entries have valid kind', () => {
    const allKeys = Object.keys(WELL_KNOWN) as WkKey[];

    it.each(allKeys)('%s: every candidate has a valid kind', key => {
      const arr = WELL_KNOWN[key] as readonly SelectorCandidate[];
      for (const candidate of arr) {
        expect(VALID_KINDS as readonly string[]).toContain(candidate.kind);
      }
    });
  });

  it('unknown key returns undefined', () => {
    // Access a non-existent key to verify it returns undefined
    const wellKnownRecord: Record<string, readonly SelectorCandidate[] | undefined> = WELL_KNOWN;
    const value = wellKnownRecord.nonExistentKey;
    expect(value).toBeUndefined();
  });
});

describe('BANK_REGISTRY — all banks use selectors: []', () => {
  const entries = Object.entries(BANK_REGISTRY) as [
    string,
    { fields: { selectors: unknown[] }[] },
  ][];

  it.each(entries)('%s has empty selectors on all login fields', (_bankName, config) => {
    for (const field of config.fields) {
      expect(field.selectors).toEqual([]);
    }
  });
});
