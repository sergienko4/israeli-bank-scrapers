import type { Brand } from '../../Types/Brand.js';

/** 32-char ASCII signing key — branded per Rule #15. */
export type PayBoxSignKey = Brand<string, 'PayBoxSignKey'>;

/**
 * PayBox crypto literals — public-extractable APK constants per D-9.
 *
 * SIGN_KEY (32 ASCII chars) signs every PayBox request body via
 * AES-CBC-PKCS7 + base64 + trailing-newline. The APK ships two
 * literal candidates: one for real-device builds, one for the
 * emulator/internal-flag path. The toggle below picks which one
 * PAYBOX_API_DIRECT_CALL hands to the mediator.
 *
 * PIN_SUFFIX (32 ASCII chars) is concatenated with
 * carry.deviceId16Hex + '|' and truncated to 32 chars to derive
 * the per-install OTP encryption key (PIN/OTP body field).
 *
 * Source: constants doc §1.2 (smali f/t/w/yf/c0.smali:216 +
 * f/t/w/cr/b.smali:122). Classed as PUBLIC-EXTRACTABLE per D-9 —
 * any APK reverse-engineer trivially recovers them, so they are
 * not secrets; they live in source as configuration.
 */

/**
 * Real-device build signing key. Default selection.
 * @see constants doc §1.2; 32-char ASCII; UTF-8 bytes feed
 * Buffer.from(SIGN_KEY, 'utf8') directly into createCipheriv.
 */
const SIGN_KEY_REAL_DEVICE = '^492wkd#x12jk4%^SewAk56zx3@xdcf5';

/**
 * Emulator / internal-flag-on alternative signing key. Documented
 * in the same APK and reachable when the internal build flag is
 * set; not the default.
 * @see constants doc §1.2.
 */
const SIGN_KEY_EMULATOR_OR_FLAG = 'Z4B4&45la23kz23)-432aa1@#^4hjdss';

/**
 * Toggle controlling which SIGN_KEY ships at compile time. D-9
 * locked the orientation that the real-device literal would be the
 * default with a one-line flip available if the live server
 * rejected it. The pre-Phase-C real-server smoke (2026-05-24, see
 * status.txt §"## Phase B-to-C real-server smoke") flipped this
 * literal: SIGN_KEY_REAL_DEVICE returned HTTP 200 with body
 * `{code:617,name:"WRONG_SIGNATURE"}`; SIGN_KEY_EMULATOR_OR_FLAG
 * returned `{code:200,content:{access_token:"eyJ..."}}` with a
 * valid 15-minute JWT. Toggle now defaults to false (i.e.
 * SIGN_KEY_EMULATOR_OR_FLAG is the live-server-accepted key). The
 * naming-convention rule requires boolean variables to begin with
 * `is*`; this is the spec-documented `USE_REAL_DEVICE_KEY` flag
 * under that prefix.
 */
const isUseRealDeviceKey = false as boolean;

/** PIN suffix used to derive the OTP-encryption key per spec.txt §4.3. */
const PIN_SUFFIX = '|<>?xdo34^mnbjh(54hnaGqaOgndsYTa';

/**
 * Post-/getKey signing-key suffix — UNUSED in this PR (D-7 skips
 * /getKey). Kept here for completeness and future flag flip.
 * @see spec.txt §4.4.
 */
const PHONE_KEY_SUFFIX = '%as2@1FaY$)(mLq%!cx';

/**
 * Resolve the active signing key for the given toggle value. The
 * default-export {@link SIGN_KEY} is the result of calling this
 * helper with the compile-time toggle; tests pass an explicit
 * value to exercise both arms.
 *
 * @param useRealDevice - True to pick {@link SIGN_KEY_REAL_DEVICE}.
 * @returns The 32-char ASCII signing key in use.
 */
export function resolveSignKey(useRealDevice: boolean): PayBoxSignKey {
  if (useRealDevice) return SIGN_KEY_REAL_DEVICE as PayBoxSignKey;
  return SIGN_KEY_EMULATOR_OR_FLAG as PayBoxSignKey;
}

/** Resolved signing key — selected by isUseRealDeviceKey toggle. */
const SIGN_KEY = resolveSignKey(isUseRealDeviceKey);

export {
  isUseRealDeviceKey,
  PHONE_KEY_SUFFIX,
  PIN_SUFFIX,
  SIGN_KEY,
  SIGN_KEY_EMULATOR_OR_FLAG,
  SIGN_KEY_REAL_DEVICE,
};
