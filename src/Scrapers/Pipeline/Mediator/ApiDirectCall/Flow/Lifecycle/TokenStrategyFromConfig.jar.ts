/**
 * Cookie-jar warm start for TokenStrategyFromConfig: the stored token
 * is the session jar (`WarmCookieJar.ts`), imported before the resumed flow
 * and exported from the jar a finished login ends with.
 */

import type { Procedure } from '../../../../Types/Procedure.js';
import { isOk } from '../../../../Types/Procedure.js';
import type { ICookieJarWarmStart } from '../../ConfigContracts/index.js';
import {
  decodeWarmJar,
  encodeWarmJar,
  type StoredJar,
  WARM_JAR_REJECTIONS,
} from '../WarmCookieJar.js';
import {
  publishWithin,
  readCredsString,
  skipWarmRestore,
} from './TokenStrategyFromConfig.shared.js';
import type { IWarmRunArgs, WarmCarry } from './TokenStrategyFromConfig.types.js';

/** A stored token about to be restored as a cookie jar. */
interface IJarRestoreArgs extends IWarmRunArgs {
  readonly jar: ICookieJarWarmStart;
  readonly stored: string;
}

/**
 * Open a stored jar for this run's provider and account.
 * @param args - Run, cookie-jar warm start and stored token.
 * @returns The cookies, or the rejection.
 */
function openStoredJar(args: IJarRestoreArgs): Procedure<StoredJar> {
  const account = readCredsString(args.creds, args.jar.accountField);
  const expected = { provider: args.jar.provider, account, maxChars: args.jar.maxTokenChars };
  return decodeWarmJar(args.stored, expected);
}

/**
 * Import a stored jar into the run's cookie session.
 * @param args - Run, cookie-jar warm start and stored token.
 * @returns An empty carry once imported, or false when skipped.
 */
function restoreJar(args: IJarRestoreArgs): WarmCarry | false {
  const credsField = args.jar.credsField;
  const session = args.bus.cookies;
  if (session === undefined) return skipWarmRestore(credsField, WARM_JAR_REJECTIONS.session);
  const cookies = openStoredJar(args);
  if (!isOk(cookies)) return skipWarmRestore(credsField, cookies.errorMessage);
  session.importAll(cookies.value);
  return {};
}

/**
 * Encode a finished run's jar as the next warm token.
 * @param args - Config, bus and creds.
 * @param jar - Cookie-jar warm start.
 * @returns The token, or '' when it has no account or does not fit.
 */
function exportJar(args: IWarmRunArgs, jar: ICookieJarWarmStart): string {
  const cookies = args.bus.cookies?.exportAll() ?? [];
  const account = readCredsString(args.creds, jar.accountField);
  const token = encodeWarmJar({ provider: jar.provider, account }, cookies);
  return publishWithin(jar, token);
}

export { exportJar, restoreJar };
