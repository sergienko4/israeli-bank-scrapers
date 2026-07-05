/**
 * Yahav BaNCS `MessageEnvelope` — fixed static blocks.
 *
 * Every field here is invariant across the accounts / balance / transactions
 * requests (verified against the captured trace). The version-bearing scalars
 * (`APP_VER`, `API_VER`) are client-build strings that BaNCS may bump on a
 * deployment; they are pinned to the captured build and re-grounded from the
 * SPA's `/BaNCSDigitalUI/*config.json` if a future trace shows drift. Split
 * from YahavShapeEnvelope.ts to keep both files within the LOC ceiling.
 */

/** Client-build version string (rides `AppVer` + every `ClientApp` node). */
export const APP_VER = 'BaNCSDigital.Web_1.3.46.BY.1.1.96.FP42_updated';

/** BaNCS Global Data Model API version. */
export const API_VER = 'GDM_1.0.88';

/** Shared `Identifier_1.0.0` version tag (rides several empty id blocks). */
const VER_IDENTIFIER = 'Identifier_1.0.0';

/** Envelope resource — the double-slash matches the captured wire form. */
export const RESOURCE = 'https://digital.yahav.co.il//BaNCSDigitalApp/account';

/** Browser user-agent carried in `ProxyApp`. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';

/** Fixed `Device` block (home-computer / Win32). */
export const DEVICE = Object.freeze({
  Ver: 'Device_1.0.0',
  DeviceId: { Ver: 'DeviceIdentifier_1.0.0' },
  Type: { CDE: 'HOMECOMPUTER', DISP: 'Home Computer' },
  OperatingSystem: { Ver: 'OperatingSystem_1.0.0', Name: 'Win32' },
});

/** Fixed `Locale` block (Hebrew / Israel). */
export const LOCALE = Object.freeze({ CDE: 'IW_IL', DISP: 'Hebrew Israel' });

/** Fixed `ProxyApp` block (browser). */
export const PROXY_APP = Object.freeze({
  Ver: 'ProxyApp_1.0.0',
  UserAgent: USER_AGENT,
  Typ: { CDE: 'BROWSER', DISP: 'Browser' },
});

/** One `ApplicationComponent` naming the Retail Internet Banking web package. */
const APP_COMPONENT = {
  Ver: 'ApplicationComponent_1.0.0',
  Nam: 'Retail Internet Banking',
  AppCompVer: APP_VER,
  Typ: { CDE: 'WEBPACKAGE', DISP: 'WEBPACKAGE' },
};

/** Fixed `ClientApp` block (Retail Internet Banking WebApp descriptor). */
export const CLIENT_APP = Object.freeze({
  Ver: 'Application_1.0.0',
  Id: { Ver: VER_IDENTIFIER },
  BldDt: { Ver: 'DateTime_1.0.0', Timezone: { Ver: 'TimeZone_1.0.0' } },
  InstlDt: { Ver: 'DateTime_1.0.0', Timezone: { Ver: 'TimeZone_1.0.0' } },
  ComptLst: { Ver: 'ApplicationComponentList_1.0.0', AppCompLst: [APP_COMPONENT] },
  ApId: { Ver: VER_IDENTIFIER },
  ApGrpId: { Ver: VER_IDENTIFIER },
  Nam: 'Retail Internet Banking',
  ApVer: APP_VER,
  Typ: { CDE: 'WEBAPP', DISP: 'WebApp' },
  CdngLng: 'Hybrid',
  TrgtOS: { CDE: 'WINDOWS', DISP: 'WINDOWS' },
});

/** Invariant envelope fields — everything except TimeStamp/SecToken/Payload/MsgId. */
export const ENVELOPE_STATIC = Object.freeze({
  Ver: 'MessageEnvelope_1.0.0',
  Device: DEVICE,
  Locale: LOCALE,
  FiId: { Ver: VER_IDENTIFIER },
  UIID: { Ver: 'UIIDomain_1.0.0' },
  DgtlTxnId: { Ver: VER_IDENTIFIER },
  Resource: RESOURCE,
  AppVer: APP_VER,
  EnvVer: 'MessageEnvelope_1.0.0',
  APIVer: API_VER,
  ProxyApp: PROXY_APP,
  ClientApp: CLIENT_APP,
  SessionId: 'sessionId',
});
