/**
 * Callback-invoking branch coverage for ElementsInteractions.
 * Mocks pageOrFrame.evaluate to invoke the callback with a synthetic
 * document.querySelector global — exercising the ?. / ?? branches.
 */

import type { Frame, Page } from 'playwright-core';

import {
  captureElementHtml,
  capturePageText,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementsInteractions.js';

/** Query outcome script. */
interface IDocScript {
  /** Selector to HTML map. Missing entries → querySelector returns null. */
  readonly elements: Record<string, string>;
  /** Page body innerText if asked. */
  readonly bodyText?: string;
}

/** Element stub shape returned by querySelector. */
interface IElementStub {
  outerHTML: string;
}
/** Querystub factory alias. */
type Querier = (sel: string) => unknown;

/**
 * Install synthetic document global with querySelector.
 * @param script - Query outcome script.
 * @returns Restore function.
 */
function installDocument(script: IDocScript): () => boolean {
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  /**
   * Query implementation bound to the script map.
   * @param sel - Selector.
   * @returns Element stub or undefined when not found.
   */
  const querier: Querier = (sel: string) => {
    if (sel in script.elements) {
      const hit: IElementStub = { outerHTML: script.elements[sel] };
      return hit;
    }
    // Fallthrough returns undefined implicitly — captureElementHtml uses ?.outerHTML which tolerates it.
    return undefined as unknown;
  };
  g.document = {
    querySelector: querier,
    body: { innerText: script.bodyText ?? '' },
  };
  return (): boolean => {
    g.document = prev;
    return true;
  };
}

/**
 * Build a page that invokes the evaluate callback with synthetic document.
 * @param script - Doc script.
 * @returns Mock page.
 */
function makeCallbackPage(script: IDocScript): Page {
  return {
    /**
     * Invoke fn(arg) under synthetic document.
     * @param fn - Inner callback.
     * @param arg - Arg.
     * @returns Callback result.
     */
    evaluate: <T>(fn: (arg?: unknown) => T, arg?: unknown): Promise<T> => {
      const restore = installDocument(script);
      try {
        const fnResult1 = fn(arg);
        return Promise.resolve(fnResult1);
      } finally {
        restore();
      }
    },
  } as unknown as Page;
}

describe('ElementsInteractions — callback invocation branches', () => {
  it('captureElementHtml callback: querySelector hit → slice outerHTML', async () => {
    const page = makeCallbackPage({ elements: { 'div.x': '<div class="x">hello</div>' } });
    const result = await captureElementHtml(page as unknown as Frame, 'div.x');
    expect(result).toContain('div');
  });

  it('captureElementHtml callback: querySelector miss → "—" via ??', async () => {
    const page = makeCallbackPage({ elements: {} });
    const result = await captureElementHtml(page as unknown as Frame, 'div.absent');
    expect(result).toBe('—');
  });

  it('capturePageText callback: body innerText + replaceAll + slice', async () => {
    const page = makeCallbackPage({
      elements: {},
      bodyText: 'hello    world   lots   of  whitespace ' + 'x'.repeat(500),
    });
    const result = await capturePageText(page);
    expect(result.length).toBeLessThanOrEqual(400);
    expect(result).toContain('hello world lots of whitespace');
  });
});
