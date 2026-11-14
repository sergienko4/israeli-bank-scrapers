/**
 * Unit tests for the BFS field search used by the transaction mapper and
 * the bank shapes. Covers the scalar matcher and the deep value collector.
 */

import {
  findAllFieldValues,
  matchField,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/BfsFieldSearch/BfsFieldSearch.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

describe('matchField', () => {
  it('returns success with original key when matched', () => {
    const result = matchField({ AccountID: 'A1' }, ['accountId']);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
    if (isOk(result)) {
      expect(result.value.originalKey).toBe('AccountID');
      expect(result.value.value).toBe('A1');
    }
  });

  it('returns failure when no key matches', () => {
    const result = matchField({ foo: 'bar' }, ['accountId']);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(false);
  });

  it('rejects non-scalar values', () => {
    const result = matchField({ accountId: { nested: 'x' } }, ['accountId']);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(false);
  });
});

describe('findAllFieldValues — deep walk over arrays + records', () => {
  it('returns every matching field across nested arrays and objects', () => {
    const obj = {
      bankAccountUniqueId: 'PARENT-BA',
      result: {
        bigNumbers: [
          {
            cards: [{ cardUniqueId: 'CARD-A' }, { cardUniqueId: 'CARD-B' }],
          },
        ],
      },
    };
    const hits = findAllFieldValues(obj, ['cardUniqueId']);
    expect(hits).toEqual(['CARD-A', 'CARD-B']);
  });

  it('returns empty when no field name matches anywhere in the tree', () => {
    const obj = { a: 1, b: { c: [{ d: 'x' }] } };
    const hits = findAllFieldValues(obj, ['missing']);
    expect(hits).toEqual([]);
  });

  it('skips null and primitive nodes encountered during the walk', () => {
    const obj = {
      list: [null, 42, 'string', { cardUniqueId: 'CARD-OK' }],
    };
    const hits = findAllFieldValues(obj, ['cardUniqueId']);
    expect(hits).toEqual(['CARD-OK']);
  });
});
