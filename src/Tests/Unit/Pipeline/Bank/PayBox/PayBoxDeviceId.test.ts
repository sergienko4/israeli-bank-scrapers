/**
 * Unit tests for PayBoxDeviceId — bootstrap + brand validator.
 *
 * Covers UC-PDI-1 / UC-PDI-2 / UC-PDI-3 per test.txt §1. The
 * deviceId16Hex value identifies a persisted PayBox device install
 * (16 lowercase hex chars = 8 random bytes). Cold-path bootstrap
 * generates it once; warm-path requires it on creds.
 */

import {
  bootstrapDeviceId16Hex,
  isDeviceId16Hex,
} from '../../../../../Scrapers/Pipeline/Banks/PayBox/PayBoxDeviceId.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';

/** Local test error class — keeps lint clean (no bare `throw new Error`). */
class TestError extends Error {
  /**
   * Construct a TestError with the supplied message.
   * @param message - Failure description.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/**
 * PRNG stub that always throws — used to force the catch branch in
 * bootstrapDeviceId16Hex via the rng injection seam.
 * @returns Never — always throws.
 */
function throwingRandomBytes(): Buffer {
  throw new TestError('synthetic PRNG failure');
}

describe('PayBoxDeviceId.bootstrapDeviceId16Hex', () => {
  it('returns 16 lowercase hex characters (UC-PDI-1)', () => {
    const result = bootstrapDeviceId16Hex();
    assertOk(result);
    expect(result.value).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns Procedure success with branded DeviceId16Hex (UC-PDI-2)', () => {
    const result = bootstrapDeviceId16Hex();
    expect(result.success).toBe(true);
    assertOk(result);
    expect(typeof result.value).toBe('string');
    expect(result.value).toHaveLength(16);
  });

  it('returns Procedure failure when injected PRNG throws (UC-PDI-2b)', () => {
    const result = bootstrapDeviceId16Hex(throwingRandomBytes);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('PayBox: deviceId bootstrap failed');
      expect(result.errorMessage).toContain('synthetic PRNG failure');
    }
  });
});

describe('PayBoxDeviceId.isDeviceId16Hex', () => {
  it('rejects uppercase hex (UC-PDI-3a)', () => {
    const isUpper = isDeviceId16Hex('ABCDEF1234567890');
    expect(isUpper).toBe(false);
  });

  it('rejects length != 16 (UC-PDI-3b)', () => {
    const isTooLong = isDeviceId16Hex('1234567890abcdef0');
    const isTooShort = isDeviceId16Hex('1234567890abcde');
    expect(isTooLong).toBe(false);
    expect(isTooShort).toBe(false);
  });

  it('rejects non-hex characters (UC-PDI-3c)', () => {
    const hasTrailingG = isDeviceId16Hex('1234567890abcdeg');
    const isAllZ = isDeviceId16Hex('zzzzzzzzzzzzzzzz');
    expect(hasTrailingG).toBe(false);
    expect(isAllZ).toBe(false);
  });

  it('accepts valid 16-lowercase-hex (UC-PDI-3d)', () => {
    const isSampleValid = isDeviceId16Hex('1083f31199640c1f');
    const isZerosValid = isDeviceId16Hex('0000000000000000');
    expect(isSampleValid).toBe(true);
    expect(isZerosValid).toBe(true);
  });
});
