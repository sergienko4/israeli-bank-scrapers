import { type Page } from 'playwright';

import waitForPageStability from '../../Common/PageStability';
import { createMockPage } from '../MockPage';

jest.mock('../../Common/Debug', () => ({
  /**
   * Returns a set of jest mock functions as a debug logger stub.
   *
   * @returns a mock debug logger with debug, info, warn, and error functions
   */
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

type DomCallback = () => boolean | null;

/**
 * Captures the callback passed to waitForFunction so it can be invoked in Node.js tests.
 *
 * @param page - the mock page whose waitForFunction will capture the callback
 * @returns an object with an invoke() function that calls the captured callback
 */
function captureCallback(page: ReturnType<typeof createMockPage>): { invoke: () => DomCallback } {
  /**
   * Placeholder callback that returns null before waitForFunction captures the real one.
   *
   * @returns null as a placeholder return value
   */
  let captured: DomCallback = () => null;
  (page.waitForFunction as jest.Mock).mockImplementation((fn: unknown) => {
    captured = fn as DomCallback;
    return Promise.resolve(null);
  });
  return {
    /**
     * Returns the captured DomCallback for invoking in test assertions.
     *
     * @returns the callback function captured from waitForFunction
     */
    invoke: () => captured,
  };
}

/**
 * Sets up a mock global document so the captured stability callback can run in Node.js.
 *
 * @param opts - document configuration for the mock
 * @param opts.readyState - the document readyState value (default: 'complete')
 * @param opts.hasNgVersion - whether a [ng-version] element is present
 * @param opts.hasNgStarInserted - whether a .ng-star-inserted element is present
 * @param opts.hasForm - whether a form element is present
 * @param opts.formClasses - CSS classes to apply to the form element
 */
function setupDocument(opts: {
  readyState?: string;
  hasNgVersion?: boolean;
  hasNgStarInserted?: boolean;
  hasForm?: boolean;
  formClasses?: string[];
}): void {
  const {
    readyState = 'complete',
    hasNgVersion = false,
    hasNgStarInserted = false,
    hasForm = true,
    formClasses = [],
  } = opts;
  const form = hasForm
    ? {
        classList: {
          /**
           * Checks whether the form element has the given CSS class.
           *
           * @param c - the class name to check
           * @returns true if the class is in the configured formClasses list
           */
          contains: (c: string): boolean => formClasses.includes(c),
        },
      }
    : null;
  Object.defineProperty(global, 'document', {
    value: {
      readyState,
      /**
       * Returns mock DOM elements for Angular-related selectors.
       *
       * @param sel - the CSS selector to query
       * @returns a mock element or null depending on the configured flags
       */
      querySelector: (sel: string): unknown => {
        if (sel === '[ng-version]') return hasNgVersion ? {} : null;
        if (sel === '.ng-star-inserted') return hasNgStarInserted ? {} : null;
        if (sel === 'form') return form;
        return null;
      },
    },
    writable: true,
    configurable: true,
  });
}

describe('waitForPageStability', () => {
  it('calls networkidle and waitForFunction', async () => {
    const page = createMockPage();
    await waitForPageStability(page as unknown as Page);
    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 5_000 });
    expect(page.waitForFunction).toHaveBeenCalled();
  });

  describe('stability callback branches', () => {
    let page: ReturnType<typeof createMockPage>;
    let invoke: () => DomCallback;

    beforeEach(async () => {
      page = createMockPage();
      ({ invoke } = captureCallback(page));
      await waitForPageStability(page as unknown as Page);
    });

    it('returns false when document not yet complete', () => {
      setupDocument({ readyState: 'loading' });
      const fn1 = invoke();
      const isStable1 = fn1();
      expect(isStable1).toBe(false);
    });

    it('returns true for non-Angular page (no ng-version, no ng-star-inserted)', () => {
      setupDocument({ hasNgVersion: false, hasNgStarInserted: false });
      const fn2 = invoke();
      const isStable2 = fn2();
      expect(isStable2).toBe(true);
    });

    it('returns true for Angular (ng-version) page with no form yet', () => {
      setupDocument({ hasNgVersion: true, hasForm: false });
      const fn3 = invoke();
      const isStable3 = fn3();
      expect(isStable3).toBe(true);
    });

    it('returns true when Angular form has ng-untouched (hydration complete)', () => {
      setupDocument({
        hasNgVersion: true,
        hasForm: true,
        formClasses: ['ng-untouched', 'ng-pristine', 'ng-invalid'],
      });
      const fn4 = invoke();
      const isStable4 = fn4();
      expect(isStable4).toBe(true);
    });

    it('returns true when Angular form has ng-invalid (hydration complete)', () => {
      setupDocument({ hasNgVersion: true, hasForm: true, formClasses: ['ng-invalid'] });
      const fn5 = invoke();
      const isStable5 = fn5();
      expect(isStable5).toBe(true);
    });

    it('returns false when Angular form has no hydration classes yet (SSR not done)', () => {
      setupDocument({ hasNgVersion: true, hasForm: true, formClasses: [] });
      const fn6 = invoke();
      const isStable6 = fn6();
      expect(isStable6).toBe(false);
    });

    it('detects Angular via ng-star-inserted class', () => {
      setupDocument({
        hasNgVersion: false,
        hasNgStarInserted: true,
        hasForm: true,
        formClasses: ['ng-invalid'],
      });
      const fn7 = invoke();
      const isStable7 = fn7();
      expect(isStable7).toBe(true);
    });
  });
});
