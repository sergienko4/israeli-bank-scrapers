/**
 * Unit tests for `Logging/BankContext` — async-local bank-context store
 * and the pino mixin record that wraps it.
 */

import {
  getBankMixin,
  runWithBankContext,
} from '../../../../Scrapers/Pipeline/Logging/BankContext.js';
import { ENVIRONMENT } from '../../../../Scrapers/Pipeline/Types/Environment.js';
import { currentRunScope } from '../../../../Scrapers/Pipeline/Types/RunScope.js';

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

  it('keeps the supplied environment when the setup bundle omits signal', () => {
    const env = { ...ENVIRONMENT, forensicTrace: true };
    const observed = runWithBankContext('hapoalim', () => currentRunScope(), { env });
    expect(observed && observed.env).toBe(env);
  });

  it('treats an empty setup bundle as a bundle, not an environment', () => {
    const observed = runWithBankContext('hapoalim', () => currentRunScope(), {});
    expect(observed && observed.env).toBe(ENVIRONMENT);
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
    expect(fields.runId).toBeUndefined();
  });
});
