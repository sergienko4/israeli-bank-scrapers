/**
 * Unit tests for ActionsBenignReject — the `isBenignPressReject`
 * predicate that narrows `pressEnter*` catch blocks to benign
 * "Enter could not fire" signals (CR PR #345 round-2 findings #3
 * and #4). Mirrors the ErrorDiscoveryDetached test shape.
 */

import {
  BENIGN_PRESS_PATTERNS,
  isBenignPressReject,
} from '../../../../../../Scrapers/Pipeline/Mediator/Form/Actions/ActionsBenignReject.js';

describe('ActionsBenignReject', () => {
  describe('isBenignPressReject', () => {
    it('returns false for a non-Error string rejection (early-out branch)', () => {
      const stringResult = isBenignPressReject('string rejection');
      expect(stringResult).toBe(false);
    });

    it('returns false for an undefined rejection', () => {
      const undefinedResult = isBenignPressReject(undefined);
      expect(undefinedResult).toBe(false);
    });

    it('returns false for a duck-typed plain object (not instanceof Error)', () => {
      const duckTyped = { name: 'TimeoutError', message: 'no element matches selector' };
      const duckResult = isBenignPressReject(duckTyped);
      expect(duckResult).toBe(false);
    });

    it('returns true for an Error whose name is TimeoutError (irrespective of message)', () => {
      const timeout = new Error('locator.press timed out after 5000ms');
      timeout.name = 'TimeoutError';
      const timeoutResult = isBenignPressReject(timeout);
      expect(timeoutResult).toBe(true);
    });

    it('returns true for every documented benign press pattern', () => {
      for (const pat of BENIGN_PRESS_PATTERNS) {
        const matchError = new Error(`prefix ${pat} suffix`);
        const matchResult = isBenignPressReject(matchError);
        expect(matchResult).toBe(true);
      }
    });

    it('returns false for an unrelated Error (real bug must propagate)', () => {
      const unrelated = new Error('TypeError: Cannot read property foo of undefined');
      const unrelatedResult = isBenignPressReject(unrelated);
      expect(unrelatedResult).toBe(false);
    });

    it('returns false for an Error with empty message and non-Timeout name', () => {
      const empty = new Error('');
      empty.name = 'SomeOtherError';
      const emptyResult = isBenignPressReject(empty);
      expect(emptyResult).toBe(false);
    });
  });
});
