/**
 * Unit tests for ErrorDiscoveryDetached — the `isElementGoneError`
 * predicate that narrows the error-discovery catch block to benign
 * frame-detached signals (CR PR #345 findings #183, #186).
 */

import {
  DETACHED_PATTERNS,
  isElementGoneError,
} from '../../../../../Scrapers/Pipeline/Mediator/Form/ErrorDiscovery/ErrorDiscoveryDetached.js';

describe('ErrorDiscoveryDetached', () => {
  describe('isElementGoneError', () => {
    it('returns false (early-out branch) for a non-Error string rejection', () => {
      const stringResult = isElementGoneError('string rejection');
      expect(stringResult).toBe(false);
    });

    it('returns false for an undefined rejection', () => {
      const undefinedResult = isElementGoneError(undefined);
      expect(undefinedResult).toBe(false);
    });

    it('returns false for a duck-typed plain object (not instanceof Error)', () => {
      const duckTyped = { message: 'Frame detached' };
      const duckResult = isElementGoneError(duckTyped);
      expect(duckResult).toBe(false);
    });

    it('returns true for every documented detach pattern', () => {
      for (const pat of DETACHED_PATTERNS) {
        const matchError = new Error(`prefix ${pat} suffix`);
        const matchResult = isElementGoneError(matchError);
        expect(matchResult).toBe(true);
      }
    });

    it('returns false for an unrelated Error', () => {
      const unrelated = new Error('TypeError: selector is null');
      const unrelatedResult = isElementGoneError(unrelated);
      expect(unrelatedResult).toBe(false);
    });
  });
});
