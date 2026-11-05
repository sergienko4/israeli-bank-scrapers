/**
 * Yahav native BaNCS envelope — the fixed blocks (spec §10.2). Key order is
 * part of the contract: the `BD_IDENT_KEY` digest covers the exact bytes, so
 * every block is declared in the order the app sends it.
 */

import {
  YAHAV_API_VER,
  YAHAV_APP_VER,
  YAHAV_CREDENTIAL,
  YAHAV_ENVELOPE_VER,
  YAHAV_NATIVE_UA,
} from '../../../Registry/Config/PipelineBankConfigYahavConstants.js';

/** Product name the client application and its one component carry. */
const PRODUCT = 'Retail Internet Banking';

/** Empty identifier block (`FiId`, `DgtlTxnId`). */
const IDENTIFIER = Object.freeze({ Ver: 'Identifier_1.0.0' });

/** The one application component: the web package at the app's build. */
const APP_COMPONENT = Object.freeze({
  Ver: 'ApplicationComponent_1.0.0',
  Nam: PRODUCT,
  AppCompVer: YAHAV_APP_VER,
  Typ: { CDE: 'WEBPACKAGE', DISP: 'WEBPACKAGE' },
});

/** The client application block. */
const CLIENT_APP = Object.freeze({
  Ver: 'Application_1.0.0',
  Nam: PRODUCT,
  ApVer: YAHAV_APP_VER,
  ComptLst: { Ver: 'ApplicationComponentList_1.0.0', AppCompLst: [APP_COMPONENT] },
  Typ: { CDE: 'WEBAPP', DISP: 'WebApp' },
  CdngLng: 'Hybrid',
  TrgtOS: { CDE: 'WINDOWS', DISP: 'WINDOWS' },
});

/** Versions and ids that follow `Ver` and `Resource`. */
const NATIVE_VERSIONS = Object.freeze({
  AppVer: YAHAV_APP_VER,
  EnvVer: YAHAV_ENVELOPE_VER,
  APIVer: YAHAV_API_VER,
  SessionId: 'sessionId',
  FiId: IDENTIFIER,
});

/** Device, locale and application blocks that follow the versions. */
const NATIVE_CHANNEL = Object.freeze({
  Device: {
    Ver: 'Device_1.0.0',
    DeviceId: { Ver: 'DeviceIdentifier_1.0.0' },
    Type: { CDE: 'HOMECOMPUTER', DISP: 'Home Computer' },
    OperatingSystem: { Ver: 'OperatingSystem_1.0.0', Name: 'Win32' },
  },
  Locale: { CDE: 'IW_IL', DISP: 'Hebrew Israel' },
  ProxyApp: { Ver: 'ProxyApp_1.0.0', UserAgent: YAHAV_NATIVE_UA },
  ClientApp: CLIENT_APP,
  UIID: { Ver: 'UIIDomain_1.0.0' },
  DgtlTxnId: IDENTIFIER,
});

/** The security token a login sends: none yet. */
const NATIVE_EMPTY_SECTOKEN = Object.freeze({
  Ver: 'SecurityToken_1.0.0',
  isArchetype: false,
  Token: [],
});

/** The login credential: an SSO session check for the retail user. */
const LOGIN_CREDENTIAL = Object.freeze({
  Ver: 'LoginUserCredentials_1.0.0',
  PrimaryVerData: {
    Ver: 'SMSessionVerificationData_1.0.0',
    isArchetype: true,
    SMSession: { Ver: 'Secret_1.0.0', isArchetype: true },
  },
  VerId: {
    Ver: 'StringVerificationIdentifier_1.0.0',
    NAME: '.',
    UserId: {
      Ver: 'UserIdentifier_1.0.0',
      isArchetype: false,
      ObjId: YAHAV_CREDENTIAL.objectId,
      UserStatus: { CDE: 'ACTIVE', DISP: 'ACTIVE' },
    },
  },
  CredScope: { CDE: 'LOGIN', DISP: 'LOGIN' },
  DomainAddr: [
    {
      Ver: 'DomainAddress_1.0.0',
      isArchetype: false,
      PlatformId: YAHAV_CREDENTIAL.platformId,
      AppId: YAHAV_CREDENTIAL.applicationId,
    },
  ],
});

/** The login payload: validate the credential. */
const NATIVE_LOGIN_PAYLOAD = Object.freeze({
  Ver: 'MessagePayload_1.0.0',
  DataEntity: [LOGIN_CREDENTIAL],
  Operation: 'VLD',
  Category: ['min'],
});

export { NATIVE_CHANNEL, NATIVE_EMPTY_SECTOKEN, NATIVE_LOGIN_PAYLOAD, NATIVE_VERSIONS };
