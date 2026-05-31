/**
 * PayBox crypto literals — public Android-client constants extracted
 * from the PayBox APK (mitm capture 2026-05-23, smali source paths
 * cited in c:/tmp/paybox-capture-2026-05-23/PAYBOX-SCRAPER-CONSTANTS.md
 * §1.2). These are identical across every Play Store install — NOT
 * user secrets. Same status as Pepper's `staticAuth` TSToken.
 *
 * `SIGN_KEY` (the real-device branch, default for production users)
 * is the AES-256 key used to sign every PayBox API request body. The
 * emulator-only alternate is documented in the constants doc and not
 * exposed here — the scraper mimics real-device behaviour.
 *
 * `PIN_SUFFIX` participates in the OTP-encryption key derivation:
 * `(deviceId16Hex + '|' + PIN_SUFFIX).slice(0, 32)`.
 */

import type {
  IAesSignerConfig,
  ICanonicalStringConfig,
} from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';

/**
 * AES-256 request-body signing key (32 ASCII bytes). Selected on the
 * `use_prod_keys` branch of the PayBox client. Live PayBox servers reject
 * the alternate branch's literal with `code: 617, name:
 * WRONG_SIGNATURE`, so this is the only accepted value.
 */
const SIGN_KEY = 'Z4B4&45la23kz23)-432aa1@#^4hjdss';

/** OTP-encryption key suffix (32 ASCII bytes). */
const PIN_SUFFIX = '|<>?xdo34^mnbjh(54hnaGqaOgndsYTa';

/** Canonical-string config shared by the class-z + class-y signers. */
const PAYBOX_CANONICAL: ICanonicalStringConfig = {
  parts: ['tsMs', 'deviceId'],
  separator: '|',
  escapeFrom: '',
  escapeTo: '',
  sortQueryParams: false,
  clientVersion: '',
};

/** Class-z signer — login flow (flat body, signature at `/signature`). */
const PAYBOX_LOGIN_SIGNER: IAesSignerConfig = {
  algorithm: 'AES-CBC-PKCS7',
  keyRef: 'config.secrets.signKey',
  ivStrategy: 'random-16',
  ivCarrySlot: 'ivHex',
  canonical: PAYBOX_CANONICAL,
  bodySignatureField: '/signature',
  bodyIvField: '/iv',
  outputPostfix: '\n',
};

/** Class-y signer — post-login scrape (nested auth, signature at `/auth/signature`). */
const PAYBOX_SCRAPE_SIGNER: IAesSignerConfig = {
  algorithm: 'AES-CBC-PKCS7',
  keyRef: 'config.secrets.signKey',
  ivStrategy: 'random-16',
  ivCarrySlot: 'ivHex',
  canonical: PAYBOX_CANONICAL,
  bodySignatureField: '/auth/signature',
  outputPostfix: '\n',
};

/** Frozen secrets bundle plugged into IApiDirectCallConfig.secrets. */
const PAYBOX_SECRETS: Readonly<Record<string, string>> = Object.freeze({
  signKey: SIGN_KEY,
  pinSuffix: PIN_SUFFIX,
});

export {
  PAYBOX_CANONICAL,
  PAYBOX_LOGIN_SIGNER,
  PAYBOX_SCRAPE_SIGNER,
  PAYBOX_SECRETS,
  PIN_SUFFIX,
  SIGN_KEY,
};
