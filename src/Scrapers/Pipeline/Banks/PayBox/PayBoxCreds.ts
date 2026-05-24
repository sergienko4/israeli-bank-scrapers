/**
 * PayBox credentials — bank-local credential shape.
 *
 * Discriminated by which token is supplied: cold creds carry an
 * otpCodeRetriever for the SMS round-trip; warm creds carry a
 * long-term JWT plus the persisted deviceId16Hex from a prior
 * cold-path run. See spec.txt §7 for the full contract.
 *
 * Brands: every PII-bearing primitive carries a nominal Brand so
 * raw `string` cannot be assigned by mistake. Producers cast at
 * the boundary; brands cost nothing at runtime.
 */

import type { Brand } from '../../Types/Brand.js';
import type { DeviceId16Hex } from './PayBoxDeviceId.js';

/** International phone number with dash separator (e.g. "972-XXXXXXXXX"). */
export type PayBoxPhone = Brand<string, 'PayBoxPhone'>;

/** Long-term JWT issued by /loginBySms — valid ~2 years per spec.txt §6.3. */
export type JwtAccessToken = Brand<string, 'JwtAccessToken'>;

/** OTP digit string entered by the user (typically 4 digits). */
export type PayBoxOtpCode = Brand<string, 'PayBoxOtpCode'>;

/** Cold-path credentials — requires an OTP retriever callback. */
export interface IPayBoxColdCreds {
  readonly phoneNumber: PayBoxPhone;
  readonly otpCodeRetriever: () => Promise<PayBoxOtpCode>;
  readonly deviceId16Hex?: DeviceId16Hex;
}

/** Warm-path credentials — long-term JWT plus persisted deviceId. */
export interface IPayBoxWarmCreds {
  readonly phoneNumber: PayBoxPhone;
  readonly otpLongTermToken: JwtAccessToken;
  readonly deviceId16Hex: DeviceId16Hex;
}

/** Discriminated PayBox credential surface — cold or warm. */
export type IPayBoxCreds = IPayBoxColdCreds | IPayBoxWarmCreds;

/**
 * Type guard — narrows IPayBoxCreds to the warm variant when the
 * caller supplied the long-term JWT.
 *
 * @param creds - PayBox credentials of either variant.
 * @returns True when the warm-path discriminator is present.
 */
export function isPayBoxWarmCreds(creds: IPayBoxCreds): creds is IPayBoxWarmCreds {
  return 'otpLongTermToken' in creds;
}
