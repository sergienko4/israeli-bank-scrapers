/**
 * Unit tests for LoginKind — verifies the enum list is exhaustive.
 */

import type LoginKind from '../../../../../Scrapers/Pipeline/Types/LoginKind.js';

/**
 * Every LoginKind key, checked exhaustively at compile time.
 * `satisfies Record<LoginKind, true>` catches added, removed or renamed keys.
 */
const LOGIN_KIND_KEYS = {
  'stored-jwt-fresh': true,
  'stored-jwt-stale': true,
  'sms-otp': true,
  'password-only': true,
  'bearer-static': true,
  unknown: true,
} satisfies Record<LoginKind, true>;

const LOGIN_KIND_VALUES = Object.keys(LOGIN_KIND_KEYS);

describe('LoginKind — exhaustive enum list', () => {
  it('contains exactly 6 values', () => {
    expect(LOGIN_KIND_VALUES).toHaveLength(6);
  });

  it('includes stored-jwt-fresh and stored-jwt-stale', () => {
    expect(LOGIN_KIND_VALUES).toContain('stored-jwt-fresh');
    expect(LOGIN_KIND_VALUES).toContain('stored-jwt-stale');
  });

  it('includes sms-otp, password-only, bearer-static, unknown', () => {
    expect(LOGIN_KIND_VALUES).toContain('sms-otp');
    expect(LOGIN_KIND_VALUES).toContain('password-only');
    expect(LOGIN_KIND_VALUES).toContain('bearer-static');
    expect(LOGIN_KIND_VALUES).toContain('unknown');
  });

  it('has no duplicate values', () => {
    const unique = new Set<string>(LOGIN_KIND_VALUES);
    expect(unique.size).toBe(LOGIN_KIND_VALUES.length);
  });
});
