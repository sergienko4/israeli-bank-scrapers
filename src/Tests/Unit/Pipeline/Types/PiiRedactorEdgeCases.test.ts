/**
 * Phase 7d coverage support — exercises edge branches of the
 * PiiRedactor censor function that the main test file doesn't hit:
 *
 *   - `toAmountValue` returning a raw string (neither number nor
 *     boolean input).
 *   - `createCensorFn` empty-tail / undefined-tail short-circuit.
 *   - The 'unknown' category path that returns `[REDACTED]`.
 *   - The empty-path short-circuit.
 */

import { classifyKey, createCensorFn } from '../../../../Scrapers/Pipeline/Types/PiiRedactor.js';

describe('PiiRedactor — censor function defensive branches', () => {
  it('empty path returns [REDACTED] sentinel', () => {
    const censor = createCensorFn();
    const hint = censor('value', []);
    expect(hint).toBe('[REDACTED]');
  });

  it('path tail empty string returns [REDACTED] sentinel', () => {
    const censor = createCensorFn();
    const hint = censor('value', ['']);
    expect(hint).toBe('[REDACTED]');
  });

  it('amount category accepts raw string input (toAmountValue string branch)', () => {
    const censor = createCensorFn();
    // Path tail 'amount' triggers the amount strategy; passing a
    // string-shaped value tests `toAmountValue`'s fall-through
    // return that hands the raw string to `redactAmount`.
    const hint = censor('123.45', ['amount']);
    expect(typeof hint).toBe('string');
  });

  it('amount category accepts boolean input (toAmountValue boolean branch)', () => {
    const censor = createCensorFn();
    const hint = censor(true, ['amount']);
    expect(typeof hint).toBe('string');
  });

  it('unknown category returns [REDACTED]', () => {
    const censor = createCensorFn();
    // 'totally-not-classified' falls through PATH_TAIL_TO_CATEGORY,
    // isTokenSuffix, and isNameSuffix → unknown → [REDACTED].
    const hint = censor('hidden-data', ['totally-not-classified']);
    expect(hint).toBe('[REDACTED]');
  });

  it('classifyKey returns "unknown" for a non-PII key name', () => {
    const category = classifyKey('totally-not-classified');
    expect(category).toBe('unknown');
  });

  it('classifyKey redacts BaNCS auth + portfolio leaf keys', () => {
    const csrf = classifyKey('csrfTkn');
    const tokenId = classifyKey('TokenId');
    const signature = classifyKey('Signature');
    const iorId = classifyKey('iorId');
    expect(csrf).toBe('token');
    expect(tokenId).toBe('token');
    expect(signature).toBe('token');
    expect(iorId).toBe('account');
  });
});
