/**
 * Carry-bundle warm start for TokenStrategyFromConfig: the stored token
 * (`WarmCarryBundle.ts`) restores the jar first, then seeds the kept carry
 * slots; a finished login publishes those slots, and the jar it ends with
 * when the config keeps one. A slot the login did not fill skips the export,
 * naming the slot only.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { ICarryBundleWarmStart } from '../ConfigContracts/index.js';
import {
  publishWithin,
  readCredsString,
  skipWarmRestore,
} from './TokenStrategyFromConfig.shared.js';
import type { IFlowCapture, IWarmRunArgs, WarmCarry } from './TokenStrategyFromConfig.types.js';
import {
  type BundleCarry,
  decodeWarmBundle,
  encodeWarmBundle,
  type IWarmBundle,
  WARM_BUNDLE_REJECTIONS,
} from './WarmCarryBundle.js';
import type { StoredJar } from './WarmCookieJar.js';
import { textAt } from './WarmTokenParts.js';

/** A stored token about to be restored as a carry bundle. */
interface IBundleRestoreArgs extends IWarmRunArgs {
  readonly bundle: ICarryBundleWarmStart;
  readonly stored: string;
}

/**
 * The account values the bundle is bound to, in config order.
 * @param args - Run whose creds hold them.
 * @param bundle - Carry-bundle warm start.
 * @returns One value per account field ('' when absent).
 */
function accountValues(args: IWarmRunArgs, bundle: ICarryBundleWarmStart): readonly string[] {
  return bundle.accountFields.map((field): string => readCredsString(args.creds, field));
}

/**
 * Open a stored bundle for this run's provider, accounts and slots.
 * @param args - Run, carry-bundle warm start and stored token.
 * @returns The bundle, or the rejection.
 */
function openStoredBundle(args: IBundleRestoreArgs): Procedure<IWarmBundle> {
  const { provider, slots, cookies: hasCookies, maxTokenChars: maxChars } = args.bundle;
  const accounts = accountValues(args, args.bundle);
  return decodeWarmBundle(args.stored, { provider, accounts, slots, hasCookies, maxChars });
}

/**
 * Import an opened bundle's jar, when it keeps one, then hand back its slots.
 * @param args - Run, carry-bundle warm start and stored token.
 * @param opened - The decoded bundle.
 * @returns The starting carry, or false when the run has no cookie session.
 */
function seedFromBundle(args: IBundleRestoreArgs, opened: IWarmBundle): WarmCarry | false {
  const { carry, cookies } = opened;
  if (cookies === false) return carry;
  const session = args.bus.cookies;
  if (session === undefined) {
    return skipWarmRestore(args.bundle.credsField, WARM_BUNDLE_REJECTIONS.session);
  }
  session.importAll(cookies);
  return carry;
}

/**
 * Open a stored bundle, import its jar, then hand its slots to the resumed flow.
 * @param args - Run, carry-bundle warm start and stored token.
 * @returns The starting carry, or false when skipped.
 */
function restoreBundle(args: IBundleRestoreArgs): WarmCarry | false {
  const opened = openStoredBundle(args);
  if (!isOk(opened)) return skipWarmRestore(args.bundle.credsField, opened.errorMessage);
  return seedFromBundle(args, opened.value);
}

/**
 * The kept slots' text in a finished flow's carry.
 * @param bundle - Carry-bundle warm start.
 * @param capture - The flow's outputs.
 * @returns Each kept slot's text, '' when the flow left it unfilled.
 */
function slotTexts(bundle: ICarryBundleWarmStart, capture: IFlowCapture): BundleCarry {
  const snapshot = capture.carrySnapshot;
  const entries = bundle.slots.map((slot): readonly [string, string] => [
    slot,
    textAt(snapshot, slot),
  ]);
  return Object.fromEntries(entries);
}

/**
 * The slots a finished login filled, as the bundle keeps them.
 * @param bundle - Carry-bundle warm start.
 * @param capture - The flow's outputs.
 * @returns The kept carry, or a failure naming the first unfilled slot.
 */
function keptCarry(bundle: ICarryBundleWarmStart, capture: IFlowCapture): Procedure<BundleCarry> {
  const carry = slotTexts(bundle, capture);
  const unfilled = bundle.slots.find((slot): boolean => carry[slot] === '');
  if (unfilled === undefined) return succeed(carry);
  return fail(ScraperErrorTypes.Generic, `slot ${unfilled} is not filled`);
}

/**
 * The jar a finished login ends with, when the bundle keeps one.
 * @param args - Run whose bus holds the session.
 * @param bundle - Carry-bundle warm start.
 * @returns The cookies, or false when the bundle keeps no jar.
 */
function keptJar(args: IWarmRunArgs, bundle: ICarryBundleWarmStart): StoredJar | false {
  if (!bundle.cookies) return false;
  return args.bus.cookies?.exportAll() ?? [];
}

/**
 * Encode filled slots, with the jar when kept, under the run's identity.
 * @param args - Config, bus and creds.
 * @param bundle - Carry-bundle warm start.
 * @param carry - The kept carry.
 * @returns The token, or the unbound rejection.
 */
function encodeKept(
  args: IWarmRunArgs,
  bundle: ICarryBundleWarmStart,
  carry: BundleCarry,
): Procedure<string> {
  const accounts = accountValues(args, bundle);
  const cookies = keptJar(args, bundle);
  const identity = { provider: bundle.provider, accounts };
  return encodeWarmBundle(identity, { carry, cookies });
}

/**
 * Encode a finished login's kept slots (and jar) as the next warm token.
 * @param args - Config, bus and creds.
 * @param bundle - Carry-bundle warm start.
 * @param capture - The flow's outputs.
 * @returns The token, or '' when a slot is unfilled, unbound or over the limit.
 */
function exportBundle(
  args: IWarmRunArgs,
  bundle: ICarryBundleWarmStart,
  capture: IFlowCapture,
): string {
  const carry = keptCarry(bundle, capture);
  if (!isOk(carry)) return publishWithin(bundle, carry);
  const token = encodeKept(args, bundle, carry.value);
  return publishWithin(bundle, token);
}

export { exportBundle, restoreBundle };
