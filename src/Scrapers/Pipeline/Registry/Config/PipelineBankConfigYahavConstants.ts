/**
 * Yahav native-app constants: the one place the protocol's origin,
 * versions, paths, header set and credential constants live, so a bank-side
 * bump touches only this file. Values are pinned from the app build the
 * protocol was traced from.
 */

import type { IBodyDigestConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

/** The native app's one origin: device registration, token and BaNCS data. */
const YAHAV_NATIVE_ORIGIN = 'https://mobile.yahav.co.il';

/** The user agent every Yahav call sends, naming the library honestly. */
const YAHAV_NATIVE_UA = 'BankApiInteroperabilityResearch/1.0';

/** The app's public OAuth client id, sent when it initializes its client. */
const YAHAV_CLIENT_ID = '48bcd201-f567-48a1-9e59-1b05f566b0f5';

/** The scopes the token call asks for. */
const YAHAV_SCOPE = 'openid msso profile';

/** The organization the device CSR names. */
const YAHAV_ORGANIZATION = 'Bank Yahav';

/** The device name the registration sends, naming the library. */
const YAHAV_DEVICE_NAME = 'IsraeliBankScrapers';

/** Login paths by call: client initialize, device register, token. */
const YAHAV_AUTH_PATHS = Object.freeze({
  initialize: '/connect/client/initialize',
  register: '/connect/device/register',
  token: '/auth/oauth/v2/token',
});

/** BaNCS client build the app reports (`AppVer`, `ClientApp` versions). */
const YAHAV_APP_VER = 'BaNCSDigitalApps.Android_1.0.0.BY.1.0.212';

/** BaNCS Global Data Model API version (`APIVer`). */
const YAHAV_API_VER = 'GDM_1.0.81';

/** BaNCS message envelope version (`Ver`, `EnvVer`). */
const YAHAV_ENVELOPE_VER = 'MessageEnvelope_1.0.0';

/** BaNCS paths by call: the login, then the three read routes. */
const YAHAV_BANCS_PATHS = Object.freeze({
  login: '/BaNCSDigitalApp/login',
  customer: '/BaNCSDigitalApp/customer',
  portfolio: '/BaNCSDigitalApp/portfolio',
  account: '/BaNCSDigitalApp/account',
});

/**
 * Headers every BaNCS call sends. Names are lower-case so they replace,
 * rather than sit beside, the transport's defaults.
 */
const YAHAV_NATIVE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'application/json; charset=UTF-8',
  accept: 'application/json',
  'user-agent': YAHAV_NATIVE_UA,
});

/**
 * The `BD_IDENT_KEY` header: base64 of
 * `AppVer~APIVer~EnvVer~sha256hex(body)` over the exact bytes sent.
 */
const YAHAV_BODY_DIGEST: IBodyDigestConfig = {
  header: 'BD_IDENT_KEY',
  prefix: `${YAHAV_APP_VER}~${YAHAV_API_VER}~${YAHAV_ENVELOPE_VER}~`,
  hash: 'sha256-hex',
  encode: 'base64',
};

/** The login credential's fixed user object, platform and application. */
const YAHAV_CREDENTIAL = Object.freeze({
  objectId: 'RetailUser',
  platformId: 'Retail',
  applicationId: 'Bancs',
});

export {
  YAHAV_API_VER,
  YAHAV_APP_VER,
  YAHAV_AUTH_PATHS,
  YAHAV_BANCS_PATHS,
  YAHAV_BODY_DIGEST,
  YAHAV_CLIENT_ID,
  YAHAV_CREDENTIAL,
  YAHAV_DEVICE_NAME,
  YAHAV_ENVELOPE_VER,
  YAHAV_NATIVE_HEADERS,
  YAHAV_NATIVE_ORIGIN,
  YAHAV_NATIVE_UA,
  YAHAV_ORGANIZATION,
  YAHAV_SCOPE,
};
