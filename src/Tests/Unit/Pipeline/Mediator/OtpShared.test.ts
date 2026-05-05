/**
 * Unit tests for Mediator/Otp/OtpShared — OTP_FALLBACK + diagnostics readers.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import {
  NOT_FOUND,
  OTP_FALLBACK,
  readDiagString,
  readDiagTarget,
  unwrapProbe,
} from '../../../../Scrapers/Pipeline/Mediator/Otp/OtpShared.js';
import type {
  IActionContext,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Diagnostics alias — hides `as never` cast pattern. */
type IDiagnosticsShape = IActionContext['diagnostics'];

describe('OTP_FALLBACK', () => {
  it('returns succeed(NOT_FOUND)', () => {
    const result = OTP_FALLBACK();
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual(NOT_FOUND);
  });
});

describe('unwrapProbe', () => {
  it('returns race value when ok and found', () => {
    const race = { ...NOT_FOUND, found: true as const, value: 'V' };
    const succeedResult1 = succeed(race);
    const unwrapped = unwrapProbe(succeedResult1);
    expect(unwrapped.found).toBe(true);
  });

  it('returns NOT_FOUND when probe failed', () => {
    const failResult2 = fail(ScraperErrorTypes.Generic, 'boom');
    const unwrapped = unwrapProbe(failResult2);
    expect(unwrapped.found).toBe(false);
  });

  it('returns NOT_FOUND when success but found=false', () => {
    const succeedResult3 = succeed(NOT_FOUND);
    const unwrapped = unwrapProbe(succeedResult3);
    expect(unwrapped.found).toBe(false);
  });
});

describe('readDiagTarget / readDiagString', () => {
  const target: IResolvedTarget = {
    contextId: 'main',
    selector: '#t',
    kind: 'css',
    candidateValue: 't',
  };

  it('readDiagTarget returns false when key missing', () => {
    const readDiagTargetResult4 = readDiagTarget({} as unknown as IDiagnosticsShape, 'missing');
    expect(readDiagTargetResult4).toBe(false);
  });

  it('readDiagTarget returns target when key present', () => {
    const diag = { otpTrigger: target } as unknown as IDiagnosticsShape;
    const result = readDiagTarget(diag, 'otpTrigger');
    expect(result).toEqual(target);
  });

  it('readDiagString returns empty string when key missing', () => {
    const readDiagStringResult5 = readDiagString({} as unknown as IDiagnosticsShape, 'missing');
    expect(readDiagStringResult5).toBe('');
  });

  it('readDiagString returns value when present', () => {
    const diag = { phoneHint: '1234' } as unknown as IDiagnosticsShape;
    const readDiagStringResult6 = readDiagString(diag, 'phoneHint');
    expect(readDiagStringResult6).toBe('1234');
  });
});
