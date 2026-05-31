/**
 * Branch-coverage tests for the pure helpers exported from
 * `Pipeline/Mediator/Selector/SelectorResolver.ts`. Each branch in
 * `toXpathLiteral`, `candidateToCss` and `isPage` is exercised in
 * isolation, independently from the network-driven probe paths. Tests
 * follow the project's "no-nested-call" rule by binding every call to
 * a const first before asserting.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfig.js';
import {
  candidateToCss,
  isPage,
  toXpathLiteral,
} from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolver.js';

describe('toXpathLiteral', () => {
  it('wraps double-quote-free input in double quotes', () => {
    const out = toXpathLiteral("user's name");
    expect(out).toBe('"user\'s name"');
  });

  it('wraps single-quote-free input in single quotes when value contains a double quote', () => {
    const out = toXpathLiteral('he said "hi"');
    expect(out).toBe('\'he said "hi"\'');
  });

  it('uses concat() when value contains both kinds of quotes', () => {
    const out = toXpathLiteral('mix\' and "quotes"');
    const isConcatPrefix = out.startsWith('concat(');
    const hasHeadFragment = out.includes('"mix\' and "');
    expect(isConcatPrefix).toBe(true);
    expect(hasHeadFragment).toBe(true);
  });
});

describe('candidateToCss', () => {
  it('builds clickableText XPath with deepest-text guard', () => {
    const cand: SelectorCandidate = { kind: 'clickableText', value: 'Sign in' };
    const css = candidateToCss(cand);
    const isXpath = css.startsWith('xpath=//*');
    expect(isXpath).toBe(true);
  });

  it('builds labelText XPath using contains()', () => {
    const cand: SelectorCandidate = { kind: 'labelText', value: 'User' };
    const css = candidateToCss(cand);
    expect(css).toContain('xpath=//label[contains(.,');
  });

  it('builds textContent XPath using contains(text())', () => {
    const cand: SelectorCandidate = { kind: 'textContent', value: 'Welcome' };
    const css = candidateToCss(cand);
    expect(css).toContain('contains(text(),');
  });

  it('passes css candidates through unchanged', () => {
    const cand: SelectorCandidate = { kind: 'css', value: '#login-form' };
    const css = candidateToCss(cand);
    expect(css).toBe('#login-form');
  });

  it('builds placeholder substring CSS', () => {
    const cand: SelectorCandidate = { kind: 'placeholder', value: 'name' };
    const css = candidateToCss(cand);
    expect(css).toBe('input[placeholder*="name"]');
  });

  it('builds ariaLabel exact-match CSS', () => {
    const cand: SelectorCandidate = { kind: 'ariaLabel', value: 'username' };
    const css = candidateToCss(cand);
    expect(css).toBe('input[aria-label="username"]');
  });

  it('builds name attribute CSS', () => {
    const cand: SelectorCandidate = { kind: 'name', value: 'pwd' };
    const css = candidateToCss(cand);
    expect(css).toBe('[name="pwd"]');
  });

  it('falls back to xpath= prefix for unknown kinds', () => {
    const cand = { kind: 'xpath', value: '//div' } as unknown as SelectorCandidate;
    const css = candidateToCss(cand);
    expect(css).toBe('xpath=//div');
  });
});

/**
 * Stub frames() so isPage's typeof check passes.
 * @returns Empty list of frames.
 */
function stubFrames(): readonly unknown[] {
  return [];
}

describe('isPage', () => {
  it('returns true for objects exposing a frames() function', () => {
    const fakePage = { frames: stubFrames } as unknown as Page;
    const isPageResult = isPage(fakePage);
    expect(isPageResult).toBe(true);
  });

  it('returns false for objects without a frames() function', () => {
    const fakeFrame = {} as unknown as Frame;
    const isPageResult = isPage(fakeFrame);
    expect(isPageResult).toBe(false);
  });
});
