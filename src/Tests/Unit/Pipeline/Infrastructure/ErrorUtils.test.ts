/**
 * Unit tests for toErrorMessage — safe error message extraction.
 * Covers: Error and string inputs (Pipeline-only types).
 */

import { toErrorMessage } from '../../../../Scrapers/Pipeline/Types/ErrorUtils.js';

describe('toErrorMessage', () => {
  it.each([
    ['Error instance', new Error('boom'), 'boom'],
    ['Error with empty message', new Error(''), ''],
    ['string value', 'crash', 'crash'],
    ['empty string', '', ''],
  ] as const)(
    /**
     * Verify toErrorMessage extracts the right string for each input type.
     * @param _label - Descriptive test case name.
     * @param input - The value passed to toErrorMessage.
     * @param expected - Expected output string.
     */
    'extracts message from %s',
    (_label, input, expected) => {
      const result = toErrorMessage(input);
      expect(result).toBe(expected);
    },
  );
});
