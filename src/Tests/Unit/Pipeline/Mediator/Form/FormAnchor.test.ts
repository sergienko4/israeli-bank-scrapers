/**
 * Unit tests for FormAnchor — form discovery + candidate scoping.
 */

import type { Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfig.js';
import {
  discoverFormAnchor,
  scopeCandidate,
  scopeCandidates,
} from '../../../../../Scrapers/Pipeline/Mediator/Form/FormAnchor.js';

/**
 * Build a mock Locator that returns scripted count/evaluateAll.
 * @param count - Element count.
 * @param evalAll - Tuples returned by evaluateAll.
 * @returns Mock Locator.
 */
function makeLocator(count: number, evalAll: unknown[] = []): Locator {
  const self: unknown = {
    /**
     * count.
     * @returns Scripted count.
     */
    count: (): Promise<number> => Promise.resolve(count),
    /**
     * first.
     * @returns Self.
     */
    first: (): Locator => self as Locator,
    /**
     * locator (nested for ancestor walk).
     * @returns Same locator.
     */
    locator: (): Locator => makeLocator(evalAll.length, evalAll),
    /**
     * evaluateAll.
     * @returns Scripted tuple array.
     */
    evaluateAll: (): Promise<unknown[]> => Promise.resolve(evalAll),
  };
  return self as Locator;
}

describe('discoverFormAnchor', () => {
  it('returns null when input locator count is 0', async () => {
    const page = {
      /**
       * locator stub.
       * @returns Empty locator.
       */
      locator: (): Locator => makeLocator(0),
    } as unknown as Page;
    const result = await discoverFormAnchor(page, '#missing');
    expect(result).toBeNull();
  });

  it('returns form selector when FORM ancestor discovered', async () => {
    // Two ancestors: a DIV wrapper and a FORM with id=loginForm. Browser
    // closures fan out 7 evaluateAll calls (column-array contract); the
    // makeExecPage stub feeds the SAME fake-element array into each
    // closure so production-shaped DOM access exercises every column.
    const div = makeFakeElement({ tagName: 'DIV' });
    const form = makeFakeElement({ tagName: 'FORM', id: 'loginForm', inputCount: 3 });
    const page = makeExecPage([div, form]);
    const result = await discoverFormAnchor(page, '#username');
    expect(result).not.toBeNull();
    if (result) expect(result.selector).toBe('#loginForm');
  });

  it('returns null when no form ancestor detected', async () => {
    const div = makeFakeElement({ tagName: 'DIV' });
    const page = makeExecPage([div]);
    const result = await discoverFormAnchor(page, '#username');
    expect(result).toBeNull();
  });

  it('treats 2-input div as form-like', async () => {
    const div = makeFakeElement({ tagName: 'DIV', id: 'frm', inputCount: 2 });
    const page = makeExecPage([div]);
    const result = await discoverFormAnchor(page, '#username');
    expect(result).not.toBeNull();
    if (result) expect(result.selector).toBe('#frm');
  });

  it('uses tag:nth-of-type when no id but sibCount > 1', async () => {
    // Two FORM siblings → sibIndex=1, sibCount=2 → form:nth-of-type(1).
    const form = makeFakeElement({
      tagName: 'FORM',
      id: '',
      inputCount: 2,
      siblings: [{ tagName: 'FORM' }],
    });
    const page = makeExecPage([form]);
    const result = await discoverFormAnchor(page, '#u');
    expect(result?.selector).toBe('form:nth-of-type(1)');
  });
});

describe('scopeCandidate', () => {
  it('scopes css candidate by prefixing form selector', () => {
    const scoped = scopeCandidate('#form', { kind: 'css', value: 'input.x' });
    expect(scoped).toEqual({ kind: 'css', value: '#form input.x' });
  });
  it('scopes placeholder candidate', () => {
    const scoped = scopeCandidate('#form', { kind: 'placeholder', value: 'Enter' });
    expect(scoped.kind).toBe('css');
    expect(scoped.value).toContain('placeholder');
  });
  it('scopes ariaLabel candidate', () => {
    const scoped = scopeCandidate('#form', { kind: 'ariaLabel', value: 'User' });
    expect(scoped.value).toContain('aria-label="User"');
  });
  it('scopes name candidate', () => {
    const scoped = scopeCandidate('#form', { kind: 'name', value: 'p' });
    expect(scoped.value).toContain('[name="p"]');
  });
  it('rewrites textContent candidate into a form-scoped xpath walk-up (#307)', () => {
    const original: SelectorCandidate = { kind: 'textContent', value: 'Submit' };
    const scoped = scopeCandidate('#form', original);
    expect(scoped.kind).toBe('xpath');
    expect(scoped.value).toContain('//*[@id="form"]');
    expect(scoped.value).toContain('Submit');
    expect(scoped.value).toContain('ancestor::*');
  });
  it('rewrites labelText candidate into a form-scoped xpath union (#307)', () => {
    const scoped = scopeCandidate('#form', { kind: 'labelText', value: 'User' });
    expect(scoped.kind).toBe('xpath');
    expect(scoped.value).toContain('//*[@id="form"]//label[contains(., "User")]');
    expect(scoped.value).toContain(' | ');
  });
  it('rewrites clickableText candidate into a form-scoped innermost xpath (#307)', () => {
    const scoped = scopeCandidate('#form', { kind: 'clickableText', value: 'Go' });
    expect(scoped.kind).toBe('xpath');
    expect(scoped.value).toContain('//*[@id="form"]');
    expect(scoped.value).toContain('Go');
  });
  it('returns text candidate unchanged when form selector is not id-bearing', () => {
    const original: SelectorCandidate = { kind: 'textContent', value: 'Submit' };
    const scoped = scopeCandidate('form.x', original);
    expect(scoped).toEqual(original);
  });
  it('prepends form-id ancestor predicate to xpath kind (#307)', () => {
    const scoped = scopeCandidate('#form', { kind: 'xpath', value: '//button' });
    expect(scoped.kind).toBe('xpath');
    expect(scoped.value).toBe('//*[@id="form"]//button');
  });
  it('leaves xpath unchanged when form selector is not id-bearing', () => {
    const scoped = scopeCandidate('form.x', { kind: 'xpath', value: '//button' });
    expect(scoped).toEqual({ kind: 'xpath', value: '//button' });
  });
  it('leaves xpath unchanged when value does not start with //', () => {
    const scoped = scopeCandidate('#form', { kind: 'xpath', value: 'button' });
    expect(scoped).toEqual({ kind: 'xpath', value: 'button' });
  });
});

describe('scopeCandidates', () => {
  it('maps all candidates through scopeCandidate', () => {
    const input: SelectorCandidate[] = [
      { kind: 'css', value: 'input' },
      { kind: 'textContent', value: 'Go' },
    ];
    const out = scopeCandidates('#form', input);
    expect(out.length).toBe(2);
    expect(out[0].value).toBe('#form input');
    expect(out[1].kind).toBe('xpath');
    expect(out[1].value).toContain('//*[@id="form"]');
  });
});

// ── mapAncestorTuples covered by invoking evaluateAll callback with fake elements ──

interface IFakeElement {
  readonly tagName: string;
  readonly id: string;
  readonly className: string;
  readonly parentElement: { readonly children: readonly IFakeElement[] } | null;
  querySelectorAll: (sel: string) => { readonly length: number };
  getAttribute: (name: string) => string;
}

/**
 * Build a fake DOM element with controllable parent/tag/input count.
 * @param spec - Element spec.
 * @param spec.tagName - HTML tag name.
 * @param spec.id - Element id.
 * @param spec.siblings - Sibling elements count or list.
 * @param spec.inputCount - Number of input elements.
 * @param spec.className - Class attribute value (B.2 stableClass branch).
 * @param spec.nameAttr - `name` attribute value (B.2 attribute-anchor branch).
 * @returns Fake element.
 */
function makeFakeElement(spec: {
  tagName: string;
  id?: string;
  siblings?: readonly { tagName: string }[];
  inputCount?: number;
  className?: string;
  nameAttr?: string;
}): IFakeElement {
  const id = spec.id ?? '';
  const inputCount = spec.inputCount ?? 0;
  const className = spec.className ?? '';
  const nameAttr = spec.nameAttr ?? '';
  const self: IFakeElement = {
    tagName: spec.tagName,
    id,
    className,
    parentElement: null,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    querySelectorAll: (): { readonly length: number } => ({ length: inputCount }),
    /**
     * Test helper — returns the configured `name` attribute when asked, or
     * empty string otherwise. Production code coalesces missing attributes
     * via `?? absent`; empty-string is the test-safe equivalent (no null).
     * @param attr - Attribute name.
     * @returns Configured value or empty string.
     */
    getAttribute: (attr: string): string => (attr === 'name' ? nameAttr : ''),
  };
  if (spec.siblings) {
    const kids = [self, ...spec.siblings.map(s => makeFakeElement({ tagName: s.tagName }))];
    Object.defineProperty(self, 'parentElement', {
      value: { children: kids },
      writable: true,
    });
  }
  return self;
}

/**
 * Build a page whose locator.evaluateAll ACTUALLY invokes the callback
 * with an array of fake Elements (hits mapAncestorTuples body).
 * @param fakeAncestors - Fake elements to pass.
 * @returns Mock Page.
 */
function makeExecPage(fakeAncestors: IFakeElement[]): Page {
  const outerLoc = {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    count: (): Promise<number> => Promise.resolve(1),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    first: (): Locator => outerLoc as unknown as Locator,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    locator: (): Locator => innerLoc as unknown as Locator,
    /**
     * Test helper.
     *
     * @param cb - Parameter.
     * @returns Result.
     */
    evaluateAll: <T>(cb: (els: unknown[]) => T): Promise<T> => {
      const cbResult = cb(fakeAncestors);
      return Promise.resolve(cbResult);
    },
  };
  const innerLoc = {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    count: (): Promise<number> => Promise.resolve(fakeAncestors.length),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    first: (): Locator => innerLoc as unknown as Locator,
    /**
     * Test helper.
     *
     * @param cb - Parameter.
     * @returns Result.
     */
    evaluateAll: <T>(cb: (els: unknown[]) => T): Promise<T> => {
      const cbResult = cb(fakeAncestors);
      return Promise.resolve(cbResult);
    },
    /**
     * Test helper.
     *
     * @returns Result.
     */
    locator: (): Locator => innerLoc as unknown as Locator,
  };
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    locator: (): Locator => outerLoc as unknown as Locator,
  } as unknown as Page;
}

describe('discoverFormAnchor — mapAncestorTuples invocation', () => {
  it('invokes mapAncestorTuples callback and discovers FORM ancestor', async () => {
    const el = makeFakeElement({
      tagName: 'FORM',
      id: 'theForm',
      inputCount: 3,
      siblings: [{ tagName: 'DIV' }],
    });
    const page = makeExecPage([el]);
    const result = await discoverFormAnchor(page, '#u');
    expect(result).not.toBeNull();
    if (result) expect(result.selector).toBe('#theForm');
  });

  it('mapAncestorTuples handles elements without parent (elvis default sibCount=1)', async () => {
    const orphan: IFakeElement = {
      tagName: 'DIV',
      id: 'orphan',
      className: '',
      parentElement: null,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      querySelectorAll: (): { readonly length: number } => ({ length: 2 }),
      /**
       * Test helper.
       *
       * @returns Empty string.
       */
      getAttribute: (): string => '',
    };
    const page = makeExecPage([orphan]);
    const result = await discoverFormAnchor(page, '#u');
    expect(result).not.toBeNull();
    if (result) expect(result.selector).toBe('#orphan');
  });

  it('mapAncestorTuples returns sibling metadata when parent has multiple children of same tag', async () => {
    const form = makeFakeElement({
      tagName: 'FORM',
      inputCount: 5,
      siblings: [{ tagName: 'FORM' }, { tagName: 'FORM' }],
    });
    const page = makeExecPage([form]);
    const result = await discoverFormAnchor(page, '#u');
    // Without id, tag:nth-of-type when sibCount > 1.
    // sibIndex is 1-based to match CSS `:nth-of-type` semantics.
    expect(result?.selector).toBe('form:nth-of-type(1)');
  });

  it('returns null when outer locator resolves but ancestor chain is empty (line 148)', async () => {
    // outerLoc.count = 1 (so line 97 passes), inner ancestor count = 0
    // → collectAncestorMeta hits the `if (count === 0) return []` branch
    const outerLoc: unknown = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      count: (): Promise<number> => Promise.resolve(1),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first: (): Locator => outerLoc as Locator,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator =>
        ({
          /**
           * Test helper.
           *
           * @returns Result.
           */
          count: (): Promise<number> => Promise.resolve(0),
          /**
           * Test helper.
           *
           * @returns Result.
           */
          first: (): Locator => null as unknown as Locator,
          /**
           * Test helper.
           *
           * @returns Result.
           */
          evaluateAll: (): Promise<unknown[]> => Promise.resolve([]),
        }) as unknown as Locator,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluateAll: (): Promise<unknown[]> => Promise.resolve([]),
    };
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => outerLoc as Locator,
    } as unknown as Page;
    const result = await discoverFormAnchor(page, '#u');
    expect(result).toBeNull();
  });

  it('buildSelectorFromMeta returns plain tag when no id and sibCount<=1 (line 200)', async () => {
    // Form ancestor without id + with no same-tag siblings (sibCount=1)
    // → uses plain 'form' tag selector, not :nth-of-type(...)
    const form = makeFakeElement({
      tagName: 'FORM',
      id: '',
      inputCount: 3,
      siblings: [{ tagName: 'DIV' }],
    });
    const page = makeExecPage([form]);
    const result = await discoverFormAnchor(page, '#u');
    expect(result?.selector).toBe('form');
  });

  it('buildSelectorFromMeta prefers tag[name="X"] when id is empty + name is set', async () => {
    // No id, but a name attribute → `form[name="login"]` (B.2 enrichment).
    const form = makeFakeElement({
      tagName: 'FORM',
      id: '',
      inputCount: 3,
      siblings: [{ tagName: 'DIV' }],
      nameAttr: 'login',
    });
    const page = makeExecPage([form]);
    const result = await discoverFormAnchor(page, '#u');
    expect(result?.selector).toBe('form[name="login"]');
  });

  it('buildSelectorFromMeta falls back to tag.stableClass when id+name absent', async () => {
    // Max-style: no id, no name, but a non-Angular class on the form.
    const form = makeFakeElement({
      tagName: 'FORM',
      id: '',
      inputCount: 3,
      siblings: [{ tagName: 'DIV' }],
      className: 'ng-untouched user-login-form ng-pristine',
    });
    const page = makeExecPage([form]);
    const result = await discoverFormAnchor(page, '#u');
    expect(result?.selector).toBe('form.user-login-form');
  });
});
