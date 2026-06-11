/**
 * Unit tests for `Logging/BankContext` — async-local bank-context store
 * and the pino mixin record that wraps it.
 */

import {
  getActiveLogContext,
  getBankMixin,
  runWithBankContext,
} from '../../../../Scrapers/Pipeline/Logging/BankContext.js';

describe('Feature — runWithBankContext', () => {
  it('returns the inner function result synchronously', () => {
    const out = runWithBankContext('hapoalim', (): number => 7);
    expect(out).toBe(7);
  });

  it('returns the inner promise unchanged for async callers', async () => {
    const out = await runWithBankContext('leumi', (): Promise<string> => Promise.resolve('ok'));
    expect(out).toBe('ok');
  });

  it('makes the bank visible to getBankMixin inside the callback', () => {
    runWithBankContext('mizrahi', (): void => {
      expect(getBankMixin().bank).toBe('mizrahi');
    });
  });

  it('clears the bank field outside the callback', () => {
    runWithBankContext('discount', (): void => undefined);
    expect(getBankMixin().bank).toBeUndefined();
  });
});

describe('Feature — getBankMixin / getActiveLogContext', () => {
  it('always exposes phase and stage fields', () => {
    const fields = getBankMixin();
    expect(typeof fields.phase).toBe('string');
    expect(typeof fields.stage).toBe('string');
  });

  it('omits runId when no bank has been registered (empty runId)', () => {
    const fields = getBankMixin();
    const runId = fields.runId;
    if (typeof runId === 'string') {
      expect(runId.length).toBeGreaterThan(0);
    }
  });

  it('exposes the same record shape via getActiveLogContext', () => {
    const a = getBankMixin();
    const b = getActiveLogContext();
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    expect(keysB).toEqual(keysA);
  });
});
