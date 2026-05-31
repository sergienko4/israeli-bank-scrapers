/**
 * Unit tests for Types/ErrorUtils — normalise thrown values to strings.
 */

import { toErrorMessage } from '../../../../Scrapers/Pipeline/Types/ErrorUtils.js';

describe('toErrorMessage', () => {
  it('returns Error.message for Error instances', () => {
    const err = new Error('something failed');
    const msg = toErrorMessage(err);
    expect(msg).toBe('something failed');
  });

  it('returns original string when value is a string', () => {
    const msg = toErrorMessage('raw string');
    expect(msg).toBe('raw string');
  });

  it('preserves empty Error.message', () => {
    const err = new Error('');
    const msg = toErrorMessage(err);
    expect(msg).toBe('');
  });

  it('preserves empty string', () => {
    const msg = toErrorMessage('');
    expect(msg).toBe('');
  });

  it('preserves subclass of Error (TypeError) message', () => {
    const err = new TypeError('bad type');
    const msg = toErrorMessage(err);
    expect(msg).toBe('bad type');
  });
});
