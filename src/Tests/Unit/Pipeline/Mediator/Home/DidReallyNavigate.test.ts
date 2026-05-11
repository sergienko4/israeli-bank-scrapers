/**
 * Did-really-navigate predicate — hash-only URL change rejection.
 *
 * <p>Visacal `<a href="#" onclick="">` clicks that miss the bound JS
 * handler add `#` to the URL but produce no real navigation. Treating
 * that as success caused HOME.ACTION to silently progress to PRE-LOGIN
 * with no login modal rendered (2026-05-11 PR #221 Phase 5 evidence).
 *
 * <p>Test Case IDs:
 *   - HOME-NAV-HASH-001: hash-only suffix change → false
 *   - HOME-NAV-HASH-002: real path change → true
 *   - HOME-NAV-HASH-003: both fragments differ (path also differs) → true
 *   - HOME-NAV-HASH-004: identical URL → false
 *   - HOME-NAV-HASH-005: same path with different fragments → false
 *   - HOME-NAV-HASH-006: query string change (no fragment) → true
 */

import { didReallyNavigate } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';

describe('didReallyNavigate — hash-only URL change is NOT real navigation', () => {
  it('HOME-NAV-HASH-001: hash-only suffix added — false', () => {
    const wasNav = didReallyNavigate('https://bank.example/home', 'https://bank.example/home#');
    expect(wasNav).toBe(false);
  });

  it('HOME-NAV-HASH-002: real path change — true', () => {
    const wasNav = didReallyNavigate('https://bank.example/home', 'https://bank.example/login');
    expect(wasNav).toBe(true);
  });

  it('HOME-NAV-HASH-003: both fragments differ AND path differs — true', () => {
    const wasNav = didReallyNavigate('https://bank.example/home#a', 'https://bank.example/login#b');
    expect(wasNav).toBe(true);
  });

  it('HOME-NAV-HASH-004: identical URL — false', () => {
    const wasNav = didReallyNavigate('https://bank.example/home', 'https://bank.example/home');
    expect(wasNav).toBe(false);
  });

  it('HOME-NAV-HASH-005: same path with different fragments only — false', () => {
    const wasNav = didReallyNavigate('https://bank.example/home#a', 'https://bank.example/home#b');
    expect(wasNav).toBe(false);
  });

  it('HOME-NAV-HASH-006: query string change is real navigation — true', () => {
    const wasNav = didReallyNavigate(
      'https://bank.example/home',
      'https://bank.example/home?ref=login',
    );
    expect(wasNav).toBe(true);
  });
});
