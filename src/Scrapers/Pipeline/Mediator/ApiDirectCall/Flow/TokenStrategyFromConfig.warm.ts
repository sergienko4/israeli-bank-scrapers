/**
 * Warm-start kinds for TokenStrategyFromConfig. A carry warm start replays the
 * stored token as a carry slot; a cookie-jar warm start replays it as the
 * session jar (`WarmCookieJar.ts`). The kind decides three moments of a prime:
 * how the stored token is restored, what a cold start resets, and which token
 * a finished flow publishes.
 */

import { getDebug } from '../../../Logging/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk } from '../../../Types/Procedure.js';
import type { ICookieJarWarmStart } from '../ConfigContracts/index.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import { isColdStart } from './TokenStrategyFromConfig.budget.js';
import { pickWarmSeed, readCredsString } from './TokenStrategyFromConfig.shared.js';
import type { IRunFlowArgs } from './TokenStrategyFromConfig.types.js';
import {
  decodeWarmJar,
  encodeWarmJar,
  type StoredJar,
  WARM_JAR_REJECTIONS,
} from './WarmCookieJar.js';
import { cookieJarWarmOf, warmCarryField } from './WarmStartKind.js';

const LOG = getDebug(import.meta.url);

/** The carry a resumed flow starts from. */
type WarmCarry = Readonly<Record<string, JsonValue>>;

/** What restoring and exporting read from a run. */
type IWarmRunArgs = Pick<IRunFlowArgs, 'config' | 'bus' | 'creds'>;

/** A stored token about to be restored as a cookie jar. */
interface IJarRestoreArgs extends IWarmRunArgs {
  readonly jar: ICookieJarWarmStart;
  readonly stored: string;
}

/** Why a finished jar that does not fit the limit is not published. */
const OVER_LIMIT = 'over maxTokenChars';

/**
 * Skip a stored jar, naming the reason and the creds field — never the token.
 * @param jar - Cookie-jar warm start.
 * @param reason - Rejection text.
 * @returns False, so the cold login runs.
 */
function skipStoredJar(jar: ICookieJarWarmStart, reason: string): false {
  LOG.warn({ credsField: jar.credsField }, `warm start skipped: ${reason}`);
  return false;
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
  const session = args.bus.cookies;
  if (session === undefined) return skipStoredJar(args.jar, WARM_JAR_REJECTIONS.session);
  const cookies = openStoredJar(args);
  if (!isOk(cookies)) return skipStoredJar(args.jar, cookies.errorMessage);
  session.importAll(cookies.value);
  return {};
}

/**
 * Turn the stored token into the resumed flow's starting carry.
 * @param args - Config, bus and creds.
 * @returns The starting carry, or false when the cold login should run.
 */
function restoreWarmSeed(args: IWarmRunArgs): WarmCarry | false {
  const stored = pickWarmSeed(args.config, args.creds);
  if (stored === false) return false;
  const jar = cookieJarWarmOf(args.config);
  if (jar !== false) return restoreJar({ ...args, jar, stored });
  const carryField = warmCarryField(args.config);
  return { [carryField]: stored };
}

/**
 * Empty a cookie-jar run's jar before a cold login, so neither a stored jar
 * nor the cookies its rejected resume set reach the fresh session.
 * @param args - Run args about to start a flow.
 * @returns True (ack contract).
 */
function prepareColdStart(args: IRunFlowArgs): true {
  const isJar = cookieJarWarmOf(args.config) !== false;
  if (isJar && isColdStart(args)) args.bus.cookies?.clear();
  return true;
}

/**
 * Publish no token, naming the reason and the creds field — never the jar.
 * @param jar - Cookie-jar warm start.
 * @param reason - Why the export is skipped.
 * @returns '' — no token.
 */
function skipExport(jar: ICookieJarWarmStart, reason: string): '' {
  LOG.warn({ credsField: jar.credsField }, `warm start export skipped: ${reason}`);
  return '';
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
  if (!isOk(token)) return skipExport(jar, token.errorMessage);
  if (token.value.length <= jar.maxTokenChars) return token.value;
  const chars = String(token.value.length);
  return skipExport(jar, `${OVER_LIMIT} (${chars} chars)`);
}

/**
 * The token a finished flow publishes for the next warm start.
 * @param args - Config, bus and creds.
 * @param flowToken - Token the flow extracted from its carry.
 * @returns The jar token for a cookie-jar run, else the flow's own token.
 */
function exportWarmToken(args: IWarmRunArgs, flowToken: string): string {
  const jar = cookieJarWarmOf(args.config);
  if (jar === false) return flowToken;
  return exportJar(args, jar);
}

export { exportWarmToken, prepareColdStart, restoreWarmSeed };
