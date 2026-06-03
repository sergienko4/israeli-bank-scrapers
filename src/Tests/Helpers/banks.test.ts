/**
 * Edge-only invariants for {@link BANKS} and {@link BankId}.
 *
 * Per project test policy (CLAUDE.md): integration tests are primary —
 * unit tests cover edges only. These tests assert structural invariants the
 * cross-bank parameterised-test helper must always hold (non-empty,
 * no duplicates, value-set matches {@link CompanyTypes}, frozen reference).
 */

import { CompanyTypes } from '../../Definitions.js';
import { type BankId, BANKS } from './banks.js';

describe('BANKS', () => {
  it('contains every CompanyTypes value in declaration order', () => {
    const enumValues = Object.values(CompanyTypes);
    const banksAsArray = [...BANKS];
    expect(banksAsArray).toEqual(enumValues);
  });

  it('is non-empty', () => {
    expect(BANKS.length).toBeGreaterThan(0);
  });

  it('contains no duplicate ids', () => {
    const unique = new Set(BANKS);
    expect(unique.size).toBe(BANKS.length);
  });

  it('is frozen — guards against accidental test-time mutation', () => {
    const isBanksFrozen = Object.isFrozen(BANKS);
    expect(isBanksFrozen).toBe(true);
  });

  it('exposes only string identifiers (no enum-key leakage)', () => {
    const isAllStrings = BANKS.every((bank): bank is BankId => typeof bank === 'string');
    expect(isAllStrings).toBe(true);
  });
});
