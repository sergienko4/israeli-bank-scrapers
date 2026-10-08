/**
 * Unit tests for the PiiRedactor bank-shape and core rules: each shape is
 * rewritten to its exact placeholder, each look-alike is left alone, and a
 * second pass over redacted output changes nothing.
 *
 * The case tables live in `PiiBankShapeCases.ts` and `PiiCoreShapeCases.ts`,
 * shared with the audit gate parity suite.
 */

import { redactPii } from '../../../Integration/Tools/PiiRedactor.js';
import {
  NEGATIVE_CASES as BANK_NEGATIVE,
  POSITIVE_CASES as BANK_POSITIVE,
} from './PiiBankShapeCases.js';
import { CORE_NEGATIVE_CASES, CORE_POSITIVE_CASES } from './PiiCoreShapeCases.js';

/** Every exact-output row. */
const POSITIVE_CASES = [...BANK_POSITIVE, ...CORE_POSITIVE_CASES];
/** Every look-alike row. */
const NEGATIVE_CASES = [...BANK_NEGATIVE, ...CORE_NEGATIVE_CASES];

describe('PiiRedactor bank-shape rules', () => {
  it.each(POSITIVE_CASES)('redacts the $key shape to its placeholder', row => {
    const out = redactPii(row.input);
    expect(out).toBe(row.expected);
  });

  it.each(NEGATIVE_CASES)('leaves a $key look-alike untouched', row => {
    const out = redactPii(row.input);
    expect(out).toBe(row.expected);
  });

  it.each(POSITIVE_CASES)('is idempotent on redacted $key output', row => {
    const again = redactPii(row.expected);
    expect(again).toBe(row.expected);
  });
});
