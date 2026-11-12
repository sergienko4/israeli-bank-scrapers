/**
 * Telebank family login — the api-direct call config and transport block a
 * Telebank brand (Discount, Mercantile) is built from.
 *
 * Password login with no OTP on the bank's own web API, then the handoff to
 * the retail app (steps in `PipelineBankConfigTelebankFamilySteps.ts`):
 *   step 1 prime         → GET the brand's login page with the routing cookies set
 *   step 2 encryptionKey → POST the app context; the bank answers its RSA key
 *   step 3 logon         → POST the formatted id, with the user code and the
 *                          password sealed under that key
 *   step 4 landing       → GET the retail app with the login cookie set
 *
 * The id is formatted before any call, as the web app does: nine digits or
 * fewer are padded to nine behind the brand's short prefix, ten digits
 * starting with 9 sit behind its long prefix, and anything else fails the
 * run. The login answer must echo the formatted id's MD5 as `MI6`. Any
 * `Error`, `error` or `actionRequired` in an answer fails the run; a login
 * `Status` other than `SUCCESS` rejects the credentials. The bank's own text
 * never reaches the error.
 *
 * The session is cookies, not an auth header, so the scheme is `'none'` and
 * the node transport keeps one cookie jar for the telebank domain. Any
 * redirect fails the run except the two hops the steps name. There is no
 * stored token, so every run logs in cold. The scheme still declares
 * `'sms-otp'`: no step has an OTP pre-hook, so the flow never asks for a code.
 */

import type {
  IApiDirectCallConfig,
  IDerivedCarry,
  IFormatRule,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { ITelebankBrand } from './PipelineBankConfigTelebankFamilyConstants.js';
import {
  TELEBANK_ORIGIN,
  TELEBANK_STATIC_HEADERS,
  telebankLoginPage,
} from './PipelineBankConfigTelebankFamilyConstants.js';
import { telebankLoginSteps } from './PipelineBankConfigTelebankFamilySteps.js';
import type { ITransportConfig } from './PipelineBankConfigTypes.js';

/** Shared transport policy: one jar for the telebank domain, no stray redirect. */
const TELEBANK_WIRE = {
  // The cookie sentinels and the cookies the steps set resolve only through it.
  nativeFetch: true,
  sessionCookies: true,
  cookieDomains: ['telebank.co.il'],
  redirectPolicy: 'reject',
} as const;

/**
 * The id formats the brand's web app sends; each pattern must match the whole id.
 * @param brand - Telebank brand.
 * @returns The format rules, short id first.
 */
function uidFormats(brand: ITelebankBrand): readonly IFormatRule[] {
  return [
    { pattern: String.raw`\d{1,9}`, prefix: brand.shortUidPrefix, padStart: 9 },
    { pattern: String.raw`9\d{9}`, prefix: brand.longUidPrefix },
  ];
}

/**
 * The cookie values the steps set, read through `config.secrets.<name>`.
 * @param brand - Telebank brand.
 * @returns The frozen value map.
 */
function cookieValues(brand: ITelebankBrand): Readonly<Record<string, string>> {
  const routing = { cssName: brand.cssName, language: 'HEBREW', t: 'P', caller: 'internet' };
  return Object.freeze({ ...routing, fte: 'true', newRetail: '1' });
}

/**
 * The brand's call-config literal — passed to `.withApiDirect(...)`.
 * @param brand - Telebank brand.
 * @returns The login config.
 */
function buildTelebankApiDirectCall(brand: ITelebankBrand): IApiDirectCallConfig {
  const rules = uidFormats(brand);
  const uid: IDerivedCarry = { into: 'uid', parts: ['creds.id'], op: { kind: 'format', rules } };
  const uidMd5: IDerivedCarry = { into: 'uidMd5', parts: ['carry.uid'], op: { kind: 'md5-hex' } };
  const head = { flow: 'sms-otp', envelope: {}, authScheme: 'none', omitBankText: true } as const;
  const creds = { id: 'digits', password: 'latin1', num: 'latin1' } as const;
  const wire = { staticHeaders: TELEBANK_STATIC_HEADERS, secrets: cookieValues(brand) };
  const steps = telebankLoginSteps(brand);
  return { ...head, ...wire, requiredCreds: creds, derivedCarry: [uid, uidMd5], steps };
}

/**
 * The brand's transport endpoints. Every path is a full URL, registered verbatim.
 * @param brand - Telebank brand.
 * @returns The transport block.
 */
function buildTelebankHeadless(brand: ITelebankBrand): ITransportConfig {
  const base = `${TELEBANK_ORIGIN}/`;
  const paths = {
    'auth.prime': telebankLoginPage(brand),
    'auth.encryptionKey': `${TELEBANK_ORIGIN}/Lobby/gatewayAPI/verification/getInfo`,
    'auth.logon': `${TELEBANK_ORIGIN}/Lobby/gatewayAPI/login`,
    'auth.landing': `${TELEBANK_ORIGIN}/apollo/retail3`,
  };
  // The family has no GraphQL; graphql mirrors identityBase to satisfy the type.
  return { identityBase: base, graphql: base, paths, ...TELEBANK_WIRE };
}

export { buildTelebankApiDirectCall, buildTelebankHeadless };
