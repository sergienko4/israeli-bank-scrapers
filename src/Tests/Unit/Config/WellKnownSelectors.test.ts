import type { SelectorCandidate } from '../../../Scrapers/Base/Config/LoginConfig.js';
import { WELL_KNOWN_LOGIN_SELECTORS } from '../../../Scrapers/Registry/WellKnownSelectors.js';

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

const WELL_KNOWN = WELL_KNOWN_LOGIN_SELECTORS;
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
