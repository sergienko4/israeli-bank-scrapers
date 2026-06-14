/**
 * Unit tests for FormErrorDiscovery.ts.
 * Tests discoverFormErrors with mock DOM evaluation — no real browser.
 *
 * The mock ctx.evaluate() returns pre-built DOM item arrays so we can
 * test the full filter → classify → summarize pipeline in isolation.
 */

import { discoverFormErrors } from '../../../../Scrapers/Pipeline/Mediator/Form/FormErrorDiscovery.js';
import { type IErrorColumnItem, makeErrorColumnCtx } from '../../../Mocks/ErrorColumnCtxFactory.js';

// ── Test data helpers ──────────────────────────────────────

/**
 * Build a visible mat-error item.
 * @param text - Error text to show.
 * @returns Visible mat-error DOM item.
 */
function matError(text: string): IErrorColumnItem {
  return { tag: 'mat-error', cls: '', text, isHidden: false };
}

/**
 * Build a hidden mat-error item.
 * @param text - Error text (hidden before submit).
 * @returns Hidden mat-error DOM item.
 */
function hiddenError(text: string): IErrorColumnItem {
  return { tag: 'mat-error', cls: '', text, isHidden: true };
}

/**
 * Build a visible role=alert item.
 * @param text - Alert text.
 * @returns Visible alert DOM item.
 */
function alertItem(text: string): IErrorColumnItem {
  return { tag: 'div', cls: '', text, isHidden: false };
}

/**
 * Build an empty visible item (no text content).
 * @returns Visible but empty DOM item.
 */
function emptyItem(): IErrorColumnItem {
  return { tag: 'div', cls: 'error', text: '', isHidden: false };
}

// ── discoverFormErrors ─────────────────────────────────────

describe('discoverFormErrors', () => {
  it('returns hasErrors=false when DOM has no error items', async () => {
    const ctx = makeErrorColumnCtx([]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(false);
    expect(scan.errors).toHaveLength(0);
    expect(scan.summary).toBe('');
  });

  it('returns hasErrors=false when all error elements are hidden', async () => {
    const ctx = makeErrorColumnCtx([hiddenError('שם משתמש לא נכון')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(false);
  });

  it('returns hasErrors=false when visible items have empty text', async () => {
    const ctx = makeErrorColumnCtx([emptyItem()]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(false);
  });

  it('returns hasErrors=true for visible mat-error with wrong-username text', async () => {
    const ctx = makeErrorColumnCtx([matError('שם משתמש לא נכון')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors[0].text).toBe('שם משתמש לא נכון');
  });

  it('returns hasErrors=true for visible mat-error with wrong-password text', async () => {
    const ctx = makeErrorColumnCtx([matError('סיסמה לא נכונה')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors[0].text).toBe('סיסמה לא נכונה');
  });

  it('returns hasErrors=true for visible role=alert with any text', async () => {
    const ctx = makeErrorColumnCtx([alertItem('שגיאה בכניסה')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors[0].text).toBe('שגיאה בכניסה');
  });

  it('collects multiple visible errors', async () => {
    const ctx = makeErrorColumnCtx([matError('שם משתמש לא נכון'), matError('סיסמה לא נכונה')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors).toHaveLength(2);
  });

  it('skips hidden errors but includes visible ones', async () => {
    const ctx = makeErrorColumnCtx([hiddenError('קוד OTP לא נכון'), matError('שם משתמש לא נכון')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.hasErrors).toBe(true);
    expect(scan.errors).toHaveLength(1);
    expect(scan.errors[0].text).toBe('שם משתמש לא נכון');
  });

  it('populates summary with first error text', async () => {
    const ctx = makeErrorColumnCtx([matError('שם משתמש לא נכון')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.summary).toBe('שם משתמש לא נכון');
  });

  it('classifies mat-error as formValidation kind', async () => {
    const ctx = makeErrorColumnCtx([matError('שם משתמש לא נכון')]);
    const scan = await discoverFormErrors(ctx);
    expect(scan.errors[0].kind).toBe('formValidation');
  });
});
