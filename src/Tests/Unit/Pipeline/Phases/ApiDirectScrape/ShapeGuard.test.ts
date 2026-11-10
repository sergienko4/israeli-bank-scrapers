/**
 * Guarded-boundary contract for shape callbacks.
 *
 * <p>A shape may throw, and an escaping exception would bypass
 * `runScrapeWithRecovery`. These specs pin both guard forms: a value-returning
 * callback and one that already returns a `Procedure`. They also pin the
 * non-`Error` throw — a `Symbol` throws again when interpolated, so the guard
 * must normalise it before building the failure message.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  guardShape,
  guardShapeProcedure,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ShapeGuard.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

describe('guardShape', () => {
  it('returns the callback value when nothing throws', () => {
    const result = guardShape('extractAccounts', () => ['a', 'b']);
    const expected = succeed(['a', 'b']);
    expect(result).toEqual(expected);
  });

  it('converts a throw into a Generic failure naming the callback', () => {
    const result = guardShape('extractAccounts', () => {
      throw new ScraperError('missing its branch code');
    });
    expect(result.success).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toBe('shape extractAccounts threw: missing its branch code');
    }
  });

  it('normalises a Symbol throw instead of rethrowing on interpolation', () => {
    const thrown: unknown = Symbol('boom');
    const result = guardShape('balance.extract', () => {
      throw thrown;
    });
    expect(result.success).toBe(false);
    if (!isOk(result)) {
      expect(result.errorMessage).toBe('shape balance.extract threw: Symbol(boom)');
    }
  });
});

describe('guardShapeProcedure', () => {
  it("preserves the callback's own typed success", () => {
    const result = guardShapeProcedure('bootstrap.extractPatch', () => succeed({ pid: 'P-1' }));
    const expected = succeed({ pid: 'P-1' });
    expect(result).toEqual(expected);
  });

  it("preserves the callback's own typed failure", () => {
    const refusal = fail(ScraperErrorTypes.Generic, 'no portfolio id');
    const result = guardShapeProcedure('bootstrap.extractPatch', () => refusal);
    expect(result).toEqual(refusal);
  });

  it('converts a throw before the callback can answer into a Generic failure', () => {
    const result = guardShapeProcedure('transactions.validatePlan', (): Procedure<void> => {
      throw new ScraperError('plan guard exploded');
    });
    expect(result.success).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toBe(
        'shape transactions.validatePlan threw: plan guard exploded',
      );
    }
  });
});
