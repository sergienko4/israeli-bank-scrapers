/**
 * Unit tests for BalanceExtractor — record-level balance resolution.
 */

import {
  isRecord,
  resolveBalanceFromRecords,
  resolveRecordBalance,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/BalanceExtractor.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

describe('isRecord', () => {
  it('returns true for plain object', () => {
    const isRecordResult1 = isRecord({ a: 1 });
    expect(isRecordResult1).toBe(true);
  });
  it('returns false for null', () => {
    const isRecordResult2 = isRecord(null);
    expect(isRecordResult2).toBe(false);
  });
  it('returns false for array', () => {
    const isRecordResult3 = isRecord([1, 2, 3]);
    expect(isRecordResult3).toBe(false);
  });
  it('returns false for primitive', () => {
    const isRecordResult4 = isRecord(42);
    expect(isRecordResult4).toBe(false);
    const isRecordResult5 = isRecord('a');
    expect(isRecordResult5).toBe(false);
  });
  it('returns false for undefined', () => {
    const isRecordResult6 = isRecord(undefined);
    expect(isRecordResult6).toBe(false);
  });
});

describe('resolveRecordBalance', () => {
  it('returns root balance match as number', () => {
    const record = { balance: 1234.56 };
    const resolveRecordBalanceResult7 = resolveRecordBalance(record);
    expect(resolveRecordBalanceResult7).toBe(1234.56);
  });

  it('returns false for null input', () => {
    const resolveRecordBalanceResult8 = resolveRecordBalance(null);
    expect(resolveRecordBalanceResult8).toBe(false);
  });

  it('returns false for undefined input', () => {
    const resolveRecordBalanceResult9 = resolveRecordBalance(undefined);
    expect(resolveRecordBalanceResult9).toBe(false);
  });

  it('descends into top-level arrays for balance', () => {
    const record = { items: [{ other: 'x' }, { balance: 500 }] };
    const resolveRecordBalanceResult10 = resolveRecordBalance(record);
    expect(resolveRecordBalanceResult10).toBe(500);
  });

  it('descends into nested-object arrays', () => {
    const record = { wrapper: { nested: [{ balance: 888 }] } };
    const resolveRecordBalanceResult11 = resolveRecordBalance(record);
    expect(resolveRecordBalanceResult11).toBe(888);
  });

  it('returns false when no balance field anywhere', () => {
    const record = { name: 'x', items: [{ other: 1 }] };
    const resolveRecordBalanceResult12 = resolveRecordBalance(record);
    expect(resolveRecordBalanceResult12).toBe(false);
  });
});

describe('resolveBalanceFromRecords', () => {
  it('finds balance in first matching record', () => {
    const records = [{ other: 'x' }, { balance: 10 }];
    const result = resolveBalanceFromRecords(records);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
    if (isOk(result)) expect(result.value).toBe(10);
  });

  it('returns failure when no record has balance', () => {
    const records = [{ a: 1 }, { b: 2 }];
    const result = resolveBalanceFromRecords(records);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(false);
  });

  it('returns failure for empty array', () => {
    const result = resolveBalanceFromRecords([]);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(false);
  });

  it('skips null records', () => {
    const records = [null, undefined, { balance: 42 }];
    const result = resolveBalanceFromRecords(records);
    const isOkResult16 = isOk(result);
    expect(isOkResult16).toBe(true);
    if (isOk(result)) expect(result.value).toBe(42);
  });
});
