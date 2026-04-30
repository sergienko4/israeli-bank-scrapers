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
    const ancestors = [
      // [tag, id, isForm, fillCount, sibIndex, sibCount]
      ['DIV', '', false, 0, 0, 1],
      ['FORM', 'loginForm', true, 3, 0, 1],
    ];
    const page = {
      /**
       * locator returns anchor-heavy locator.
       * @returns Mock locator.
       */
      locator: (): Locator => makeLocator(1, ancestors),
    } as unknown as Page;
    const result = await discoverFormAnchor(page, '#username');
    expect(result).not.toBeNull();
    if (result) expect(result.selector).toBe('#loginForm');
  });

  it('returns null when no form ancestor detected', async () => {
    const ancestors = [['DIV', '', false, 0, 0, 1]];
    const page = {
      /**
       * locator.
       * @returns Mock locator.
       */
      locator: (): Locator => makeLocator(1, ancestors),
    } as unknown as Page;
    const result = await discoverFormAnchor(page, '#username');
    expect(result).toBeNull();
  });

  it('treats 2-input div as form-like', async () => {
    const ancestors = [['DIV', 'frm', false, 2, 0, 1]];
    const page = {
      /**
       * locator.
       * @returns Mock locator.
       */
      locator: (): Locator => makeLocator(1, ancestors),
    } as unknown as Page;
    const result = await discoverFormAnchor(page, '#username');
    expect(result).not.toBeNull();
    if (result) expect(result.selector).toBe('#frm');
  });

  it('uses tag:nth-of-type when no id but sibCount > 1', async () => {
    const ancestors = [['FORM', '', true, 2, 1, 2]];
    const page = {
      /**
       * locator.
       * @returns Mock locator.
       */
      locator: (): Locator => makeLocator(1, ancestors),
    } as unknown as Page;
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
  it('passes through unscopable textContent kind unchanged', () => {
    const original: SelectorCandidate = { kind: 'textContent', value: 'Submit' };
    const scopeCandidateResult1 = scopeCandidate('#form', original);
    expect(scopeCandidateResult1).toEqual(original);
  });
  it('passes through xpath kind unchanged', () => {
    const original: SelectorCandidate = { kind: 'xpath', value: '//button' };
    const scopeCandidateResult2 = scopeCandidate('#form', original);
    expect(scopeCandidateResult2).toEqual(original);
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
    expect(out[1]).toEqual(input[1]);
  });
});

// ── mapAncestorTuples covered by invoking evaluateAll callback with fake elements ──

interface IFakeElement {
  readonly tagName: string;
  readonly id: string;
  readonly parentElement: { readonly children: readonly IFakeElement[] } | null;
  querySelectorAll: (sel: string) => { readonly length: number };
}

/**
 * Build a fake DOM element with controllable parent/tag/input count.
 * @param spec - Element spec.
 * @param spec.tagName - HTML tag name.
 * @param spec.id - Element id.
 * @param spec.siblings - Sibling elements count or list.
 * @param spec.inputCount - Number of input elements.
 * @returns Fake element.
 */
function makeFakeElement(spec: {
  tagName: string;
  id?: string;
  siblings?: readonly { tagName: string }[];
  inputCount?: number;
}): IFakeElement {
  const id = spec.id ?? '';
  const inputCount = spec.inputCount ?? 0;
  const self: IFakeElement = {
    tagName: spec.tagName,
    id,
    parentElement: null,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    querySelectorAll: (): { readonly length: number } => ({ length: inputCount }),
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
      const cbResult = cb(fakeAncestors as unknown[]);
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
      const cbResult = cb(fakeAncestors as unknown[]);
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
      parentElement: null,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      querySelectorAll: (): { readonly length: number } => ({ length: 2 }),
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
    // Without id, tag:nth-of-type when sibCount > 1
    expect(result?.selector).toBe('form:nth-of-type(0)');
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
});
