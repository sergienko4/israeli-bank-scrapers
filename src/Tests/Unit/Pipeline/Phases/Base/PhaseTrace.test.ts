/**
 * Phase-trace reason tests.
 *
 * <p>Guards the contract that a FAIL carries its cause. A stage used to
 * log a bare `FAIL`, so a failing run said nothing about why and the
 * reason had to be recovered from a forensic bundle.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { traceReason } from '../../../../../Scrapers/Pipeline/Phases/Base/PhaseTrace.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

describe('traceReason', () => {
  // Healthy lines must keep their existing shape, so the caller can
  // spread the result unconditionally.
  it('adds nothing to a successful stage', () => {
    const ok = succeed({});
    const reason = traceReason(ok);
    expect(reason).toEqual({});
  });

  it('carries the failure message so the log explains itself', () => {
    const failure = fail(ScraperErrorTypes.Generic, 'no password field');
    const reason = traceReason(failure);
    expect(reason.errorMessage).toBe('no password field');
  });

  // The type is what lets a consumer pivot FAILs without parsing prose.
  it('carries the error type alongside the message', () => {
    const failure = fail(ScraperErrorTypes.InvalidPassword, 'bad creds');
    const reason = traceReason(failure);
    expect(reason.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  // The message is operator-supplied text that reaches a log sink, so it
  // goes through the same masking every other visible string does.
  it('masks an oversized message rather than logging it whole', () => {
    const previous = process.env.PII_REDACTION;
    delete process.env.PII_REDACTION;
    const long = 'x'.repeat(5_000);
    const failure = fail(ScraperErrorTypes.Generic, long);
    const reason = traceReason(failure);
    if (previous !== undefined) process.env.PII_REDACTION = previous;
    expect(reason.errorMessage.length).toBeLessThan(long.length);
  });
});
