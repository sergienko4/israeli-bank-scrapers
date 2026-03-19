/**
 * Unit tests for FormErrorDiscovery.ts — both layers.
 * Layer 1: discoverFormErrors (DOM structural scan via evaluate).
 * Layer 2: checkFrameForErrors (WellKnown text scan via getByText).
 */

import type { Page } from 'playwright-core';

import {
  checkFrameForErrors,
  discoverFormErrors,
  NO_ERRORS,
} from '../../../../../Scrapers/Pipeline/Mediator/FormErrorDiscovery.js';

// ── DOM item type ─────────────────────────────────────────

/** Mirrors the internal IRawDomItem used by discoverFormErrors. */
interface IDomItem {
  tag: string;
  cls: string;
  text: string;
  isHidden: boolean;
}

/**
 * Build a mock ctx/page whose evaluate returns given DOM items.
 * @param items - DOM items to simulate in the page evaluate call.
 * @returns Mock Page with evaluate returning items.
 */
const MAKE_CTX_L1 = (items: readonly IDomItem[]): Page =>
  ({
    /**
     * Return the provided items from evaluate.
     * @returns Resolved items array.
     */
    evaluate: (): Promise<readonly IDomItem[]> => Promise.resolve(items),
  }) as unknown as Page;

/**
 * Build a mock ctx that throws in evaluate (detached or broken page).
 * @returns Mock Page whose evaluate always rejects.
 */
const MAKE_CTX_THROWS = (): Page =>
  ({
    /**
     * Always rejects to simulate a broken evaluate.
     * @returns Rejected promise.
     */
    evaluate: (): Promise<never> => Promise.reject(new Error('evaluate failed')),
  }) as unknown as Page;

/**
 * Visible mat-error item with given text.
 * @param text - Error text content.
 * @returns Visible mat-error DOM item.
 */
const MAT_ERROR_ITEM = (text: string): IDomItem => ({
  tag: 'mat-error',
  cls: '',
  text,
  isHidden: false,
});

/**
 * Hidden mat-error item (before form submit).
 * @param text - Error text content.
 * @returns Hidden mat-error DOM item.
 */
const HIDDEN_ERROR_ITEM = (text: string): IDomItem => ({
  tag: 'mat-error',
  cls: '',
  text,
  isHidden: true,
});

/**
 * Visible div with role=alert text.
 * @param text - Alert text content.
 * @returns Visible alert DOM item.
 */
const ALERT_ITEM = (text: string): IDomItem => ({ tag: 'div', cls: '', text, isHidden: false });

/** Visible but empty item (no text content). */
const EMPTY_VISIBLE_ITEM: IDomItem = { tag: 'div', cls: 'error', text: '', isHidden: false };

/**
 * Build a mock page where getByText returns isVisible based on visibleTexts.
 * @param visibleTexts - Texts that should be "visible".
 * @returns Mock Page for Layer 2 tests.
 */
const MAKE_FRAME_L2 = (visibleTexts: readonly string[]): Page =>
  ({
    /**
     * Return a locator whose isVisible depends on visibleTexts.
     * @param text - Text to check visibility for.
     * @returns Locator with first().isVisible().
     */
    getByText: (text: string) => ({
      /**
       * Return first-element locator.
       * @returns First locator with isVisible.
       */
      first: () => ({
        /**
         * Return true if text is in visibleTexts.
         * @returns Promise<boolean>.
         */
        isVisible: (): Promise<boolean> => {
          const isFound = visibleTexts.includes(text);
          return Promise.resolve(isFound);
        },
      }),
    }),
  }) as unknown as Page;

/**
 * Build a detached frame mock where isVisible always throws.
 * @returns Mock Page that throws on isVisible.
 */
const MAKE_DETACHED_FRAME = (): Page =>
  ({
    /**
     * Return a locator that always throws on isVisible.
     * @returns Locator with throwing first().
     */
    getByText: () => ({
      /**
       * Return first-element locator that throws.
       * @returns Throwing first locator.
       */
      first: () => ({
        /**
         * Always rejects (detached frame simulation).
         * @returns Rejected promise.
         */
        isVisible: (): Promise<boolean> => Promise.reject(new Error('Frame detached')),
      }),
    }),
  }) as unknown as Page;

// ── NO_ERRORS constant ────────────────────────────────────

describe('NO_ERRORS', () => {
  it('has hasErrors=false, empty errors, empty summary', () => {
    expect(NO_ERRORS.hasErrors).toBe(false);
    expect(NO_ERRORS.errors).toHaveLength(0);
    expect(NO_ERRORS.summary).toBe('');
  });
});

// ── discoverFormErrors (Layer 1) ──────────────────────────

describe('discoverFormErrors/no-errors', () => {
  it('returns hasErrors=false for empty DOM', async () => {
    const ctx = MAKE_CTX_L1([]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(false);
  });

  it('returns hasErrors=false when all items are hidden', async () => {
    const hiddenItem = HIDDEN_ERROR_ITEM('שגיאה');
    const ctx = MAKE_CTX_L1([hiddenItem]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(false);
  });

  it('returns hasErrors=false when visible items have empty text', async () => {
    const ctx = MAKE_CTX_L1([EMPTY_VISIBLE_ITEM]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(false);
  });

  it('returns hasErrors=false when evaluate throws (graceful catch)', async () => {
    const ctx = MAKE_CTX_THROWS();
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(false);
  });
});

describe('discoverFormErrors/found', () => {
  it('returns hasErrors=true for visible mat-error', async () => {
    const item = MAT_ERROR_ITEM('שם משתמש לא נכון');
    const ctx = MAKE_CTX_L1([item]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors[0].text).toBe('שם משתמש לא נכון');
  });

  it('returns hasErrors=true for visible role=alert', async () => {
    const item = ALERT_ITEM('שגיאה בכניסה');
    const ctx = MAKE_CTX_L1([item]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors[0].text).toBe('שגיאה בכניסה');
  });

  it('collects multiple visible errors', async () => {
    const item1 = MAT_ERROR_ITEM('שם משתמש לא נכון');
    const item2 = MAT_ERROR_ITEM('סיסמה לא נכונה');
    const ctx = MAKE_CTX_L1([item1, item2]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.errors).toHaveLength(2);
  });

  it('skips hidden errors, includes visible', async () => {
    const hidden = HIDDEN_ERROR_ITEM('hidden error');
    const visible = MAT_ERROR_ITEM('visible error');
    const ctx = MAKE_CTX_L1([hidden, visible]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.errors).toHaveLength(1);
    expect(scan.errors[0].text).toBe('visible error');
  });

  it('summary = first error text', async () => {
    const item = MAT_ERROR_ITEM('first error');
    const ctx = MAKE_CTX_L1([item]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.summary).toBe('first error');
  });

  it('classifies mat-error as formValidation', async () => {
    const item = MAT_ERROR_ITEM('error');
    const ctx = MAKE_CTX_L1([item]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.errors[0].kind).toBe('formValidation');
  });

  it('classifies non-mat-error tag as authError', async () => {
    const item = ALERT_ITEM('alert');
    const ctx = MAKE_CTX_L1([item]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.errors[0].kind).toBe('authError');
  });
});

// ── checkFrameForErrors (Layer 2) ────────────────────────

describe('checkFrameForErrors/no-errors', () => {
  it('returns hasErrors=false when no WellKnown text visible', async () => {
    const frame = MAKE_FRAME_L2([]);
    const scan = await checkFrameForErrors(frame);
    expect(scan.hasErrors).toBe(false);
    expect(scan.summary).toBe('');
  });

  it('returns hasErrors=false when frame is detached', async () => {
    const frame = MAKE_DETACHED_FRAME();
    const scan = await checkFrameForErrors(frame);
    expect(scan.hasErrors).toBe(false);
  });
});

describe('checkFrameForErrors/found', () => {
  it('returns hasErrors=true for Discount "פרטים שגויים"', async () => {
    const frame = MAKE_FRAME_L2(['פרטים שגויים']);
    const scan = await checkFrameForErrors(frame);
    expect(scan.hasErrors).toBe(true);
    expect(scan.summary).toBe('פרטים שגויים');
  });

  it('returns hasErrors=true for VisaCal error text', async () => {
    const visaCalErr = 'שם המשתמש או הסיסמה שהוזנו שגויים';
    const frame = MAKE_FRAME_L2([visaCalErr]);
    const scan = await checkFrameForErrors(frame);
    expect(scan.hasErrors).toBe(true);
    expect(scan.summary).toBe(visaCalErr);
  });

  it('stops at first match in WellKnown order', async () => {
    const frame = MAKE_FRAME_L2(['פרטים שגויים', 'שגיאה']);
    const scan = await checkFrameForErrors(frame);
    expect(scan.summary).toBe('פרטים שגויים');
  });

  it('errors array has wellKnown selector and authError kind', async () => {
    const frame = MAKE_FRAME_L2(['פרטים שגויים']);
    const scan = await checkFrameForErrors(frame);
    expect(scan.errors[0].selector).toBe('wellKnown');
    expect(scan.errors[0].kind).toBe('authError');
  });
});
