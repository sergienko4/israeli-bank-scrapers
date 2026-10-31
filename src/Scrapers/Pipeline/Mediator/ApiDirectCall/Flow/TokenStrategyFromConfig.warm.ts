/**
 * Warm-start kinds for TokenStrategyFromConfig. A carry warm start replays the
 * stored token as a carry slot; a cookie-jar warm start replays it as the
 * session jar (`TokenStrategyFromConfig.jar.ts`); a carry-bundle warm start
 * replays several slots and, optionally, the jar
 * (`TokenStrategyFromConfig.bundle.ts`). The kind decides three moments of a
 * prime: how the stored token is restored, what a cold start resets, and
 * which token a finished flow publishes.
 */

import type { ICarryBundleWarmStart, ICookieJarWarmStart } from '../ConfigContracts/index.js';
import { isColdStart } from './TokenStrategyFromConfig.budget.js';
import { exportBundle, restoreBundle } from './TokenStrategyFromConfig.bundle.js';
import { exportJar, restoreJar } from './TokenStrategyFromConfig.jar.js';
import { pickWarmSeed } from './TokenStrategyFromConfig.shared.js';
import type {
  IFlowCapture,
  IRunFlowArgs,
  IWarmRunArgs,
  WarmCarry,
} from './TokenStrategyFromConfig.types.js';
import { carryBundleWarmOf, cookieJarWarmOf, warmCarryField } from './WarmStartKind.js';

/** How one warm-start kind restores a stored token and publishes the next. */
interface IWarmKindOps {
  /** Turn a stored token into the resumed flow's starting carry; false runs cold. */
  readonly restore: (stored: string) => WarmCarry | false;
  /** The token a finished flow publishes for the next warm start. */
  readonly publish: (capture: IFlowCapture) => string;
}

/**
 * Cookie-jar ops: the stored token is the session jar.
 * @param args - Config, bus and creds.
 * @param jar - Cookie-jar warm start.
 * @returns The kind's ops.
 */
function jarOps(args: IWarmRunArgs, jar: ICookieJarWarmStart): IWarmKindOps {
  return {
    /**
     * Import the stored jar.
     * @param stored - Stored token.
     * @returns An empty carry, or false when skipped.
     */
    restore: (stored: string): WarmCarry | false => restoreJar({ ...args, jar, stored }),
    /**
     * Encode the jar the login ended with.
     * @returns The jar token, or ''.
     */
    publish: (): string => exportJar(args, jar),
  };
}

/**
 * Carry-bundle ops: the stored token holds the kept slots and, optionally, the jar.
 * @param args - Config, bus and creds.
 * @param bundle - Carry-bundle warm start.
 * @returns The kind's ops.
 */
function bundleOps(args: IWarmRunArgs, bundle: ICarryBundleWarmStart): IWarmKindOps {
  return {
    /**
     * Import the stored jar, then seed the kept slots.
     * @param stored - Stored token.
     * @returns The kept slots, or false when skipped.
     */
    restore: (stored: string): WarmCarry | false => restoreBundle({ ...args, bundle, stored }),
    /**
     * Encode the slots (and jar) the login ended with.
     * @param capture - The flow's outputs.
     * @returns The bundle token, or ''.
     */
    publish: (capture: IFlowCapture): string => exportBundle(args, bundle, capture),
  };
}

/**
 * Carry ops: the stored token is one carry slot, and the flow's own token is
 * the next one.
 * @param carryField - Slot the token seeds ('' when there is no warm start).
 * @returns The kind's ops.
 */
function carryOps(carryField: string): IWarmKindOps {
  return {
    /**
     * Seed the carry slot with the stored token.
     * @param stored - Stored token.
     * @returns The starting carry.
     */
    restore: (stored: string): WarmCarry => ({ [carryField]: stored }),
    /**
     * Publish the token the flow extracted.
     * @param capture - The flow's outputs.
     * @returns The flow's long-term token.
     */
    publish: (capture: IFlowCapture): string => capture.longTermToken,
  };
}

/**
 * The ops of the config's warm-start kind.
 * @param args - Config, bus and creds.
 * @returns Ops for the declared kind; carry ops when there is none.
 */
function warmOpsOf(args: IWarmRunArgs): IWarmKindOps {
  const jar = cookieJarWarmOf(args.config);
  if (jar !== false) return jarOps(args, jar);
  const bundle = carryBundleWarmOf(args.config);
  if (bundle !== false) return bundleOps(args, bundle);
  const carryField = warmCarryField(args.config);
  return carryOps(carryField);
}

/**
 * Turn the stored token into the resumed flow's starting carry.
 * @param args - Config, bus and creds.
 * @returns The starting carry, or false when the cold login should run.
 */
function restoreWarmSeed(args: IWarmRunArgs): WarmCarry | false {
  const stored = pickWarmSeed(args.config, args.creds);
  if (stored === false) return false;
  const ops = warmOpsOf(args);
  return ops.restore(stored);
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
 * The token a finished flow publishes for the next warm start.
 * @param args - Config, bus and creds.
 * @param capture - The flow's outputs: its own token and carry.
 * @returns The token the warm-start kind publishes.
 */
function exportWarmToken(args: IWarmRunArgs, capture: IFlowCapture): string {
  const ops = warmOpsOf(args);
  return ops.publish(capture);
}

export { exportWarmToken, prepareColdStart, restoreWarmSeed };
