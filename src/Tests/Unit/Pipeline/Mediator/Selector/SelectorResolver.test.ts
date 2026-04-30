/**
 * Unit tests for SelectorResolver — XPath escape, candidate→CSS,
 * credential key extraction, page detection, queryWithTimeout.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfig.js';
import {
  candidateToCss,
  extractCredentialKey,
  isPage,
  queryWithTimeout,
  toXpathLiteral,
  tryInContextInternal,
} from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolver.js';

describe('toXpathLiteral', () => {
  it('wraps plain string in double quotes', () => {
    const toXpathLiteralResult1 = toXpathLiteral('hello');
    expect(toXpathLiteralResult1).toBe('"hello"');
  });
  it('uses single quotes when value contains double quotes', () => {
    const toXpathLiteralResult2 = toXpathLiteral('a"b');
    expect(toXpathLiteralResult2).toBe("'a\"b'");
  });
  it('uses concat when value has both quote kinds', () => {
    const out = toXpathLiteral('it\'s "fun"');
    const didStartWithResult3 = out.startsWith('concat(');
    expect(didStartWithResult3).toBe(true);
  });
});

describe('candidateToCss', () => {
  it('converts clickableText to XPath', () => {
    const c: SelectorCandidate = { kind: 'clickableText', value: 'Go' };
    const candidateToCssResult4 = candidateToCss(c);
    expect(candidateToCssResult4).toContain('xpath=');
  });
  it('converts labelText to XPath with label()', () => {
    const c: SelectorCandidate = { kind: 'labelText', value: 'Username' };
    const candidateToCssResult5 = candidateToCss(c);
    expect(candidateToCssResult5).toContain('label');
  });
  it('converts textContent to XPath with text()', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'Login' };
    const candidateToCssResult6 = candidateToCss(c);
    expect(candidateToCssResult6).toContain('text()');
  });
  it('returns raw value for css kind', () => {
    const c: SelectorCandidate = { kind: 'css', value: '#id' };
    const candidateToCssResult7 = candidateToCss(c);
    expect(candidateToCssResult7).toBe('#id');
  });
  it('builds placeholder selector', () => {
    const c: SelectorCandidate = { kind: 'placeholder', value: 'enter' };
    const candidateToCssResult8 = candidateToCss(c);
    expect(candidateToCssResult8).toBe('input[placeholder*="enter"]');
  });
  it('builds ariaLabel selector', () => {
    const c: SelectorCandidate = { kind: 'ariaLabel', value: 'User' };
    const candidateToCssResult9 = candidateToCss(c);
    expect(candidateToCssResult9).toBe('input[aria-label="User"]');
  });
  it('builds name selector', () => {
    const c: SelectorCandidate = { kind: 'name', value: 'pw' };
    const candidateToCssResult10 = candidateToCss(c);
    expect(candidateToCssResult10).toBe('[name="pw"]');
  });
  it('falls through unknown kind to xpath=', () => {
    const c = { kind: 'xpath' as const, value: '//button' };
    const candidateToCssResult11 = candidateToCss(c);
    expect(candidateToCssResult11).toBe('xpath=//button');
  });
});

describe('extractCredentialKey', () => {
  it('maps #username → username', () => {
    const extractCredentialKeyResult12 = extractCredentialKey('#username');
    expect(extractCredentialKeyResult12).toBe('username');
  });
  it('maps #password → password', () => {
    const extractCredentialKeyResult13 = extractCredentialKey('#password');
    expect(extractCredentialKeyResult13).toBe('password');
  });
  it('substring fallback to known key', () => {
    const extractCredentialKeyResult14 = extractCredentialKey('#loginUsername');
    expect(extractCredentialKeyResult14).toBe('username');
  });
  it('short id-prefixed field maps to id', () => {
    const extractCredentialKeyResult15 = extractCredentialKey('#id');
    expect(extractCredentialKeyResult15).toBe('id');
  });
  it('returns raw id when nothing matches', () => {
    const extractCredentialKeyResult16 = extractCredentialKey('#unknownfield');
    expect(extractCredentialKeyResult16).toBe('unknownfield');
  });
  it('handles non-id selector (returns the selector itself when unknown)', () => {
    const extractCredentialKeyResult17 = extractCredentialKey('div.foo');
    expect(extractCredentialKeyResult17).toBe('div.foo');
  });
});

describe('isPage', () => {
  it('returns true for objects with frames function', () => {
    const p = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      frames: (): Frame[] => [],
    } as unknown as Page;
    const isPageResult18 = isPage(p);
    expect(isPageResult18).toBe(true);
  });
  it('returns false for objects without frames', () => {
    const f = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      name: (): string => '',
    } as unknown as Frame;
    const isPageResult19 = isPage(f);
    expect(isPageResult19).toBe(false);
  });
});

describe('queryWithTimeout', () => {
  it('returns false when $() returns null', async () => {
    const ctx = {
      /**
       * Mock $.
       * @returns Resolved null.
       */
      $: (): Promise<null> => Promise.resolve(null),
    } as unknown as Page;
    const isFound = await queryWithTimeout(ctx, '#x');
    expect(isFound).toBe(false);
  });

  it('returns true when $() resolves an element', async () => {
    const ctx = {
      /**
       * Mock $.
       * @returns Resolved dummy element.
       */
      $: (): Promise<Record<string, unknown>> => Promise.resolve({}),
    } as unknown as Page;
    const isFound = await queryWithTimeout(ctx, '#x');
    expect(isFound).toBe(true);
  });
});

describe('tryInContextInternal', () => {
  it('returns empty result for empty candidates array', async () => {
    const ctx = {
      /**
       * Mock $.
       * @returns Resolved null.
       */
      $: (): Promise<null> => Promise.resolve(null),
    } as unknown as Page;
    const result = await tryInContextInternal(ctx, []);
    expect(result.css).toBe('');
  });

  it('returns empty result when all candidates fail to match', async () => {
    const ctx = {
      /**
       * Mock $ returns null.
       * @returns Resolved null.
       */
      $: (): Promise<null> => Promise.resolve(null),
      /**
       * Mock locator — count returns 0.
       * @returns Mock locator.
       */
      locator: (): unknown => ({
        /**
         * First.
         * @returns Self.
         */
        first: (): unknown => ({
          /**
           * Count.
           * @returns 0.
           */
          count: (): Promise<number> => Promise.resolve(0),
        }),
      }),
    } as unknown as Page;
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#missing' }];
    const result = await tryInContextInternal(ctx, candidates);
    expect(result.css).toBe('');
  });
});
