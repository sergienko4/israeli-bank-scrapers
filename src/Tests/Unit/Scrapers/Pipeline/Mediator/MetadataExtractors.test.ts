/**
 * Unit tests for MetadataExtractors.ts.
 * Mocks ctx.evaluate and locator.isVisible to test all paths.
 * JSDOM evaluate-callback tests use manual JSDOM instance for branch coverage.
 */

import type { Frame, Page } from 'playwright-core';

type MockStr = string;

import {
  EMPTY_METADATA,
  extractMetadata,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/MetadataExtractors.js';

// ── Helpers ────────────────────────────────────────────────

/** Raw DOM props shape returned by evaluate. */
interface IRawProps {
  id: MockStr;
  className: MockStr;
  tagName: MockStr;
  type: MockStr;
  name: MockStr;
  formId: MockStr;
  ariaLabel: MockStr;
  placeholder: MockStr;
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
     * Return a mock locator with isVisible + evaluate support.
     * @returns Locator mock matching Playwright API.
     */
    locator: () => ({
      /**
       * Return first-element locator.
       * @returns First locator with isVisible and evaluate.
       */
      first: () => ({
        /**
         * Return isVisible based on test setup.
         * @returns Promise boolean.
         */
        isVisible: (): Promise<boolean> =>
          visibleThrows
            ? Promise.reject(new Error('locator detached'))
            : Promise.resolve(isVisible),
        /**
         * Return mock props as if extracted from DOM.
         * @returns Resolved props.
         */
        evaluate: (): Promise<IRawProps> => Promise.resolve(props),
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

// ── JSDOM evaluate-callback branches ─────────────────────

const { JSDOM } = await import('jsdom');

/**
 * Build a mock ctx whose evaluate RUNS the callback with a JSDOM document.
 * Injects JSDOM globals so the evaluate callback branches get covered.
 * @param html - HTML to populate the JSDOM body.
 * @param isVisible - Whether locator.isVisible returns true.
 * @returns Mock Page that executes evaluate in JSDOM.
 */
function makeJsdomCtx(html: string, isVisible = true): Page | Frame {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const domDoc = dom.window.document;
  return {
    /**
     * Execute callback with JSDOM document injected as global.
     * @param fn - Evaluate callback.
     * @param arg - Callback argument.
     * @returns Resolved callback result.
     */
    evaluate: <T>(fn: (arg: unknown) => T, arg: unknown): Promise<T> => {
      const prevDoc = globalThis.document;
      Object.defineProperty(globalThis, 'document', {
        value: domDoc,
        writable: true,
        configurable: true,
      });
      try {
        const result = fn(arg);
        return Promise.resolve(result);
      } finally {
        Object.defineProperty(globalThis, 'document', {
          value: prevDoc,
          writable: true,
          configurable: true,
        });
      }
    },
    /**
     * Return locator mock.
     * @returns Locator with first().isVisible().
     */
    /**
     * Return locator that resolves against JSDOM document.
     * @param selector - CSS selector to locate.
     * @returns Locator mock with first().isVisible() and first().evaluate().
     */
    locator: (selector: string): object => ({
      /**
       * Return first-element locator with evaluate and isVisible.
       * @returns First locator mock.
       */
      first: (): object => ({
        /**
         * Return visibility based on test setup.
         * @returns Visibility state.
         */
        isVisible: (): Promise<boolean> => Promise.resolve(isVisible),
        /**
         * Run callback with the matched DOM element.
         * @param fn - Callback receiving the DOM element.
         * @returns Resolved callback result.
         */
        evaluate: <T>(fn: (_el: Element) => T): Promise<T> => {
          const el = domDoc.querySelector(selector);
          if (!el) return Promise.reject(new TypeError('Element not found'));
          const result = fn(el);
          return Promise.resolve(result);
        },
      }),
    }),
  } as unknown as Page;
}

describe('extractMetadata/jsdom-evaluate', () => {
  it('returns empty props when element not found (querySelector null)', async () => {
    const ctx = makeJsdomCtx('', false);
    const meta = await extractMetadata(ctx, '#nonexistent');
    expect(meta.id).toBe('');
    expect(meta.tagName).toBe('');
    expect(meta.isVisible).toBe(false);
  });

  it('extracts all properties from real DOM input element', async () => {
    const html =
      '<form id="login"><input id="user" class="mat" type="text" name="username" placeholder="Enter" aria-label="User"></form>';
    const ctx = makeJsdomCtx(html, true);
    const meta = await extractMetadata(ctx, '#user');
    expect(meta.id).toBe('user');
    expect(meta.className).toBe('mat');
    expect(meta.tagName).toBe('input');
    expect(meta.type).toBe('text');
    expect(meta.name).toBe('username');
    expect(meta.formId).toBe('login');
    expect(meta.ariaLabel).toBe('User');
    expect(meta.placeholder).toBe('Enter');
  });

  it('returns empty formId when no ancestor form', async () => {
    const ctx = makeJsdomCtx('<input id="orphan" type="text">', true);
    const meta = await extractMetadata(ctx, '#orphan');
    expect(meta.formId).toBe('');
  });

  it('returns empty ariaLabel when attribute absent', async () => {
    const ctx = makeJsdomCtx('<input id="nolabel" type="text">', true);
    const meta = await extractMetadata(ctx, '#nolabel');
    expect(meta.ariaLabel).toBe('');
  });
});
