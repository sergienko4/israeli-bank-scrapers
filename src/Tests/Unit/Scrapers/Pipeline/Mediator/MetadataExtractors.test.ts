/**
 * Unit tests for MetadataExtractors.ts.
 * Mocks ctx.evaluate and locator.isVisible to test all paths.
 */

import type { Frame, Page } from 'playwright-core';

import {
  EMPTY_METADATA,
  extractMetadata,
} from '../../../../../Scrapers/Pipeline/Mediator/MetadataExtractors.js';

// ── Helpers ────────────────────────────────────────────────

/** Raw DOM props shape returned by evaluate. */
interface IRawProps {
  id: string;
  className: string;
  tagName: string;
  type: string;
  name: string;
  formId: string;
  ariaLabel: string;
  placeholder: string;
}

/** Full DOM props for a typical Angular Material input. */
const FULL_PROPS: IRawProps = {
  id: 'mat-input-2',
  className: 'mat-input-element',
  tagName: 'input',
  type: 'text',
  name: 'username',
  formId: 'login-form',
  ariaLabel: 'שם משתמש',
  placeholder: '',
};

/** Empty props (element not found). */
const EMPTY_PROPS: IRawProps = {
  id: '',
  className: '',
  tagName: '',
  type: '',
  name: '',
  formId: '',
  ariaLabel: '',
  placeholder: '',
};

/**
 * Build a mock ctx that returns given props from evaluate and optional isVisible.
 * @param props - DOM props to return.
 * @param isVisible - Whether locator.first().isVisible() returns true.
 * @param visibleThrows - Whether isVisible throws instead.
 * @returns Mock Page/Frame.
 */
function makeMockCtx(props: IRawProps, isVisible = true, visibleThrows = false): Page | Frame {
  return {
    /**
     * Return evaluate result from mock.
     * @returns Resolved props.
     */
    evaluate: (): Promise<IRawProps> => Promise.resolve(props),
    /**
     * Return a minimal locator mock.
     * @returns Locator with first().isVisible().
     */
    locator: () => ({
      /**
       * Return first-element locator.
       * @returns First locator with isVisible.
       */
      first: () => ({
        /**
         * Return isVisible based on test setup.
         * @returns Promise<boolean>.
         */
        isVisible: (): Promise<boolean> =>
          visibleThrows
            ? Promise.reject(new Error('locator detached'))
            : Promise.resolve(isVisible),
      }),
    }),
  } as unknown as Page;
}

// ── EMPTY_METADATA constant ───────────────────────────────

describe('EMPTY_METADATA', () => {
  it('has all empty string fields', () => {
    expect(EMPTY_METADATA.id).toBe('');
    expect(EMPTY_METADATA.className).toBe('');
    expect(EMPTY_METADATA.tagName).toBe('');
    expect(EMPTY_METADATA.type).toBe('');
    expect(EMPTY_METADATA.name).toBe('');
    expect(EMPTY_METADATA.formId).toBe('');
    expect(EMPTY_METADATA.ariaLabel).toBe('');
    expect(EMPTY_METADATA.placeholder).toBe('');
  });

  it('has isVisible=false', () => {
    expect(EMPTY_METADATA.isVisible).toBe(false);
  });
});

// ── extractMetadata ───────────────────────────────────────

describe('extractMetadata/success', () => {
  it('populates all fields from evaluate result', async () => {
    const ctx = makeMockCtx(FULL_PROPS, true);
    const meta = await extractMetadata(ctx, '#mat-input-2');
    expect(meta.id).toBe('mat-input-2');
    expect(meta.className).toBe('mat-input-element');
    expect(meta.tagName).toBe('input');
    expect(meta.type).toBe('text');
    expect(meta.name).toBe('username');
    expect(meta.formId).toBe('login-form');
    expect(meta.ariaLabel).toBe('שם משתמש');
    expect(meta.placeholder).toBe('');
  });

  it('sets isVisible=true when locator.isVisible returns true', async () => {
    const ctx = makeMockCtx(FULL_PROPS, true);
    const meta = await extractMetadata(ctx, '#mat-input-2');
    expect(meta.isVisible).toBe(true);
  });

  it('sets isVisible=false when locator.isVisible returns false', async () => {
    const ctx = makeMockCtx(FULL_PROPS, false);
    const meta = await extractMetadata(ctx, '#mat-input-2');
    expect(meta.isVisible).toBe(false);
  });
});

describe('extractMetadata/empty-element', () => {
  it('returns empty fields when element is not found (evaluate returns empty)', async () => {
    const ctx = makeMockCtx(EMPTY_PROPS, false);
    const meta = await extractMetadata(ctx, '#not-found');
    expect(meta.tagName).toBe('');
    expect(meta.id).toBe('');
  });
});

describe('extractMetadata/error-handling', () => {
  it('sets isVisible=false when locator.isVisible throws', async () => {
    const ctx = makeMockCtx(FULL_PROPS, true, true);
    const meta = await extractMetadata(ctx, '#mat-input-2');
    expect(meta.isVisible).toBe(false);
  });
});
