/**
 * PayBox device-id helper — bootstrap + branded type + validator.
 *
 * The device-id is a 16-character lowercase-hex string (8 random
 * bytes) that PayBox uses as a persisted client install identifier.
 * Cold-path login generates a fresh value via crypto.randomBytes(8);
 * warm-path login requires the previously-bootstrapped value on
 * creds.deviceId16Hex (see spec.txt §5 carry.deviceId16Hex
 * provenance).
 *
 * The brand satisfies Rule #15 (no raw-string returns for primitives
 * that carry domain meaning). Callers obtain a branded value either
 * from {@link bootstrapDeviceId16Hex} or by passing a raw string
 * through the {@link isDeviceId16Hex} guard.
 */

import { randomBytes } from 'node:crypto';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Brand } from '../../Types/Brand.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** 16-character lowercase-hex device identifier (8 random bytes). */
export type DeviceId16Hex = Brand<string, 'DeviceId16Hex'>;

/** Validation pattern — 16 lowercase hex characters exactly. */
const DEVICE_ID_PATTERN = /^[0-9a-f]{16}$/;

/** Random-byte count for {@link bootstrapDeviceId16Hex} — 8 bytes = 16 hex chars. */
const DEVICE_ID_BYTE_COUNT = 8;

/** PRNG seam — production uses Node's crypto.randomBytes; tests inject a stub. */
export type RandomBytesFn = (size: number) => Buffer;

/**
 * Generate a fresh 16-hex device identifier for first cold-path
 * login. The caller persists the value (e.g. via
 * onAuthFlowComplete) so subsequent warm-path runs can reuse it.
 *
 * The catch block casts the unknown to Error before reading .message;
 * Node's crypto.randomBytes only ever throws Error subclasses, so
 * the cast is sound. This keeps the function branch-total without
 * an instanceof guard whose false arm would be unreachable in
 * production paths.
 *
 * @param rng - PRNG seam; defaults to Node's crypto.randomBytes.
 *              Tests inject a stub that throws to exercise the
 *              failure branch.
 * @returns Procedure success with a freshly-minted DeviceId16Hex;
 *          failure when the system PRNG rejects the byte request.
 */
export function bootstrapDeviceId16Hex(rng: RandomBytesFn = randomBytes): Procedure<DeviceId16Hex> {
  try {
    const hex = rng(DEVICE_ID_BYTE_COUNT).toString('hex');
    return succeed(hex as DeviceId16Hex);
  } catch (error: unknown) {
    const reason = (error as Error).message;
    return fail(ScraperErrorTypes.Generic, `PayBox: deviceId bootstrap failed (${reason})`);
  }
}

/**
 * Validate that a raw string matches the PayBox device-id format
 * (16 lowercase hex chars). Used at the warm-path boundary to
 * narrow `string` into `DeviceId16Hex`.
 *
 * @param value - Raw candidate string.
 * @returns True when the value is exactly 16 lowercase hex chars.
 */
export function isDeviceId16Hex(value: string): value is DeviceId16Hex {
  return DEVICE_ID_PATTERN.test(value);
}
