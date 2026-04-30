/**
 * Unit tests for SelectorCandidate — target/match fields + helper utilities.
 * Tests backward compatibility (no target/match) and new behavior.
 */

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import {
  getCandidateTarget,
  validateCandidateMatch,
} from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';

// ── Backward compatibility ───────────────────────────────

describe('SelectorCandidate/backward-compat', () => {
  it('accepts candidates without target or match', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה' };
    expect(c.kind).toBe('textContent');
    expect(c.value).toBe('כניסה');
  });

  it.each([
    { kind: 'labelText' as const, value: 'שם משתמש' },
    { kind: 'placeholder' as const, value: 'הזן סיסמה' },
    { kind: 'ariaLabel' as const, value: 'כניסה' },
    { kind: 'name' as const, value: 'password' },
    { kind: 'xpath' as const, value: '//button' },
    { kind: 'css' as const, value: '#login' },
    { kind: 'regex' as const, value: '^שלום\\s+\\S+' },
    { kind: 'clickableText' as const, value: 'כניסה' },
  ])('$kind candidate works without target/match', candidate => {
    const c: SelectorCandidate = candidate;
    expect(c.kind).toBe(candidate.kind);
    expect(c.value).toBe(candidate.value);
  });
});

// ── target field ──────────────────────────────────────────

describe('SelectorCandidate/target', () => {
  it('accepts target: self', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה', target: 'self' };
    expect(c.target).toBe('self');
  });

  it('accepts target: input', () => {
    const c: SelectorCandidate = { kind: 'labelText', value: 'שם משתמש', target: 'input' };
    expect(c.target).toBe('input');
  });

  it('accepts target: parent', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה', target: 'parent' };
    expect(c.target).toBe('parent');
  });

  it('accepts target: href', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה', target: 'href' };
    expect(c.target).toBe('href');
  });
});

// ── match field ───────────────────────────────────────────

describe('SelectorCandidate/match', () => {
  it('accepts match as a string pattern', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה', match: '/login' };
    expect(c.match).toBe('/login');
  });

  it('accepts both target and match together', () => {
    const c: SelectorCandidate = {
      kind: 'textContent',
      value: 'כניסה לחשבון',
      target: 'href',
      match: '/login|/connect',
    };
    expect(c.target).toBe('href');
    expect(c.match).toBe('/login|/connect');
  });
});

// ── getCandidateTarget helper ─────────────────────────────

describe('getCandidateTarget', () => {
  it('returns self when target is undefined', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה' };
    const target = getCandidateTarget(c);
    expect(target).toBe('self');
  });

  it('returns the explicit target value', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה', target: 'href' };
    const target = getCandidateTarget(c);
    expect(target).toBe('href');
  });

  it.each(['self', 'input', 'parent', 'href'] as const)('returns %s when set', targetVal => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'x', target: targetVal };
    const resolved = getCandidateTarget(c);
    expect(resolved).toBe(targetVal);
  });
});

// ── validateCandidateMatch helper ─────────────────────────

describe('validateCandidateMatch', () => {
  it('returns true when candidate has no match field', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה' };
    const isValid = validateCandidateMatch(c, '/branches');
    expect(isValid).toBe(true);
  });

  it('returns true when value matches the pattern', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה', match: '/login' };
    const isValid = validateCandidateMatch(c, 'https://bank.co.il/login');
    expect(isValid).toBe(true);
  });

  it('returns false when value does NOT match the pattern', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה', match: '/login' };
    const isValid = validateCandidateMatch(c, 'https://bank.co.il/branches');
    expect(isValid).toBe(false);
  });

  it('supports regex alternation in match', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'כניסה', match: '/login|/connect' };
    const isValidConnect = validateCandidateMatch(c, 'https://bank.co.il/connect');
    const isValidAbout = validateCandidateMatch(c, 'https://bank.co.il/about');
    expect(isValidConnect).toBe(true);
    expect(isValidAbout).toBe(false);
  });

  it('is case-insensitive for Hebrew/English matching', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'Login', match: 'login' };
    const isValid = validateCandidateMatch(c, 'LOGIN PAGE');
    expect(isValid).toBe(true);
  });

  it('returns true when value is empty string and no match', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'x' };
    const isValid = validateCandidateMatch(c, '');
    expect(isValid).toBe(true);
  });

  it('returns false when value is empty string and match requires content', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'x', match: '/login' };
    const isValid = validateCandidateMatch(c, '');
    expect(isValid).toBe(false);
  });
});
