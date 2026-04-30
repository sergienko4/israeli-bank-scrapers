/**
 * Unit tests for FormErrorDiscovery.ts.
 * Tests discoverFormErrors with mock DOM evaluation — no real browser.
 *
 * The mock ctx.evaluate() returns pre-built DOM item arrays so we can
 * test the full filter → classify → summarize pipeline in isolation.
 */

import type { Page } from 'playwright-core';

import { discoverFormErrors } from '../../../../Scrapers/Pipeline/Mediator/Form/FormErrorDiscovery.js';

// ── DOM item shapes ────────────────────────────────────────

/** Mirror of IRawDomItem from FormErrorDiscovery — for test construction. */
interface IDomItem {
  tag: string;
  cls: string;
  text: string;
  isHidden: boolean;
}

/**
 * Build a mock Page whose evaluate() returns the given DOM items.
 * @param items - Pre-built DOM item array to simulate page.evaluate result.
 * @returns Mock Page for discoverFormErrors.
 */
function makeMockCtx(items: readonly IDomItem[]): Page {
  return {
    /**
     * Ignore the fn and arg — return pre-built items directly.
     * @returns Promise resolving to the mock items.
     */
    evaluate: (): Promise<readonly IDomItem[]> => Promise.resolve(items),
  } as unknown as Page;
}

// ── Test data helpers ──────────────────────────────────────

/**
 * Build a visible mat-error item.
 * @param text - Error text to show.
 * @returns Visible mat-error DOM item.
 */
function matError(text: string): IDomItem {
  return { tag: 'mat-error', cls: '', text, isHidden: false };
}

/**
 * Build a hidden mat-error item.
 * @param text - Error text (hidden before submit).
 * @returns Hidden mat-error DOM item.
 */
function hiddenError(text: string): IDomItem {
  return { tag: 'mat-error', cls: '', text, isHidden: true };
}

/**
 * Build a visible role=alert item.
 * @param text - Alert text.
 * @returns Visible alert DOM item.
 */
function alertItem(text: string): IDomItem {
  return { tag: 'div', cls: '', text, isHidden: false };
}

/**
 * Build an empty visible item (no text content).
 * @returns Visible but empty DOM item.
 */
function emptyItem(): IDomItem {
  return { tag: 'div', cls: 'error', text: '', isHidden: false };
}

// ── discoverFormErrors ─────────────────────────────────────

describe('discoverFormErrors', () => {
  it('returns hasErrors=false when DOM has no error items', async () => {
    const ctx = makeMockCtx([]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(false);
    expect(scan.errors).toHaveLength(0);
    expect(scan.summary).toBe('');
  });

  it('returns hasErrors=false when all error elements are hidden', async () => {
    const ctx = makeMockCtx([hiddenError('שם משתמש לא נכון')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(false);
  });

  it('returns hasErrors=false when visible items have empty text', async () => {
    const ctx = makeMockCtx([emptyItem()]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(false);
  });

  it('returns hasErrors=true for visible mat-error with wrong-username text', async () => {
    const ctx = makeMockCtx([matError('שם משתמש לא נכון')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors[0].text).toBe('שם משתמש לא נכון');
  });

  it('returns hasErrors=true for visible mat-error with wrong-password text', async () => {
    const ctx = makeMockCtx([matError('סיסמה לא נכונה')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors[0].text).toBe('סיסמה לא נכונה');
  });

  it('returns hasErrors=true for visible role=alert with any text', async () => {
    const ctx = makeMockCtx([alertItem('שגיאה בכניסה')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors[0].text).toBe('שגיאה בכניסה');
  });

  it('collects multiple visible errors', async () => {
    const ctx = makeMockCtx([matError('שם משתמש לא נכון'), matError('סיסמה לא נכונה')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors).toHaveLength(2);
  });

  it('skips hidden errors but includes visible ones', async () => {
    const ctx = makeMockCtx([hiddenError('קוד OTP לא נכון'), matError('שם משתמש לא נכון')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors).toHaveLength(1);
    expect(scan.errors[0].text).toBe('שם משתמש לא נכון');
  });

  it('populates summary with first error text', async () => {
    const ctx = makeMockCtx([matError('שם משתמש לא נכון')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.summary).toBe('שם משתמש לא נכון');
  });

  it('classifies mat-error as formValidation kind', async () => {
    const ctx = makeMockCtx([matError('שם משתמש לא נכון')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.errors[0].kind).toBe('formValidation');
  });
});
