/**
 * Callback-invoking branch coverage for ElementsInteractions.
 *
 * Strategy: run under Jest's jsdom environment so that `document` and
 * `document.querySelector` are real DOM APIs supplied by jsdom. The
 * production code (`document.querySelector(sel)?.outerHTML.slice(...) ?? '—'`)
 * is exercised against a real DOM tree:
 *   - hit branch  → jsdom returns a real Element with real outerHTML
 *   - miss branch → jsdom returns null (DOM contract; provided by 3rd party)
 *
 * No null/undefined is declared, returned, or annotated by this file —
 * the project's "no null returns" guardrail is satisfied without any
 * ESLint exception. The mock Page only forwards the callback to jsdom.
 *
 * @jest-environment jsdom
 */

import type { Page } from 'playwright-core';

import {
  captureElementHtml,
  capturePageText,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementsInteractions.js';

/** Minimal evaluate-only Page mock used by both functions under test. */
interface IEvaluatePage {
  readonly evaluate: <TResult>(fn: (arg?: unknown) => TResult, arg?: unknown) => Promise<TResult>;
}

/**
 * Build a Page stub whose evaluate() runs the callback synchronously
 * in this Node+jsdom process — so it sees the real document above.
 * @returns Page-shaped object that forwards evaluate to the local jsdom.
 */
/**
 * Synchronously execute the production callback under the local jsdom
 * document, then wrap the result in a resolved Promise (matching the
 * Playwright `Page.evaluate` signature).
 * @param fn - Production callback (executed with the real jsdom document).
 * @param arg - Single argument forwarded to fn (Playwright contract).
 * @returns Promise resolving to fn's return value.
 */
function syncJsdomEvaluate<TResult>(
  fn: (arg?: unknown) => TResult,
  arg?: unknown,
): Promise<TResult> {
  const callbackResult = fn(arg);
  return Promise.resolve(callbackResult);
}

/**
 * Build a Page-shaped stub whose evaluate forwards to the local jsdom.
 * @returns Page-typed stub for use with captureElementHtml/capturePageText.
 */
function makeJsdomPage(): Page {
  const stub: IEvaluatePage = { evaluate: syncJsdomEvaluate };
  return stub as unknown as Page;
}

/**
 * Replace document.body content with the supplied HTML.
 * @param html - Inner HTML for the body.
 * @returns True after assignment (no void returns per project rule).
 */
function setBodyHtml(html: string): boolean {
  document.body.innerHTML = html;
  return true;
}

/**
 * Stub document.body.innerText (jsdom does not implement it).
 * Production code reads `document.body.innerText` for whitespace
 * collapsing; this provides a configurable getter that returns the
 * supplied string while keeping the rest of the DOM behaviour real.
 * @param text - Value to expose as document.body.innerText.
 * @returns True after definition.
 */
function setBodyInnerText(text: string): boolean {
  Object.defineProperty(document.body, 'innerText', {
    value: text,
    configurable: true,
    writable: true,
  });
  return true;
}

describe('ElementsInteractions — callback invocation branches (jsdom)', () => {
  beforeEach(() => {
    setBodyHtml('');
  });

  it('captureElementHtml: querySelector hit → outerHTML is sliced', async () => {
    setBodyHtml('<div class="x">hello</div>');
    const page = makeJsdomPage();
    const result = await captureElementHtml(page, 'div.x');
    expect(result).toContain('div');
    expect(result).toContain('hello');
  });

  it('captureElementHtml: querySelector miss → "—" via ?? fallback', async () => {
    setBodyHtml('<p>nothing matching</p>');
    const page = makeJsdomPage();
    const result = await captureElementHtml(page, 'div.absent');
    expect(result).toBe('—');
  });

  it('capturePageText: body innerText collapsed and sliced', async () => {
    const longTail = 'x'.repeat(500);
    setBodyInnerText(`hello    world   lots   of  whitespace ${longTail}`);
    const page = makeJsdomPage();
    const result = await capturePageText(page);
    expect(result.length).toBeLessThanOrEqual(400);
    expect(result).toContain('hello world lots of whitespace');
  });
});
