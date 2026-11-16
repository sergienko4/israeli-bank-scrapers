/**
 * WK URL vocabulary — the generic endpoint groups a urlTag may name, plus the
 * branded inline-URL alternative. Defined in Types so capability ports such as
 * `ITokenBus` do not depend on the Registry; the WK registry re-exports it.
 */

import type { Brand } from '../Brand.js';

/** Supported WK URL groups — generic API endpoints. */
type WKUrlGroup =
  | 'identityBase'
  | 'graphql'
  | 'identity.deviceToken'
  | 'identity.otpPrepare'
  | 'identity.otpVerify'
  | 'identity.getIdToken'
  | 'identity.sessionToken'
  | 'identity.phoneValidate'
  | 'identity.pinValidation'
  | 'identity.loginBySms'
  | 'auth.bind'
  | 'auth.login'
  | 'auth.assert'
  | 'auth.logout'
  | 'auth.prime'
  | 'auth.resume'
  | 'auth.service'
  | 'auth.bootstrap'
  | 'auth.landing'
  | 'auth.logon'
  | 'auth.encryptionKey'
  | 'auth.identify'
  | 'auth.verify'
  | 'auth.otpInit'
  | 'auth.otpVerify'
  | 'auth.step1'
  | 'auth.arcotid'
  | 'auth.stepupInit'
  | 'auth.stepupVerify'
  | 'auth.arcotidAfter'
  | 'data.sync'
  | 'data.getKey'
  | 'data.getUserHistory'
  | 'data.virtualCardTranRequest';

/** Branded inline absolute URL for a urlTag. */
type LiteralUrl = Brand<string, 'WkLiteralUrl'>;

/** A urlTag: either a registered WK group OR an inline absolute URL. */
type WKUrlOrLiteral = WKUrlGroup | LiteralUrl;

export type { LiteralUrl, WKUrlGroup, WKUrlOrLiteral };
