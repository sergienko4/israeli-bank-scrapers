/**
 * Flow execution helpers for TokenStrategyFromConfig:
 * runs the configured SMS-OTP flow, captures the long-term token,
 * and implements the warm/cold prime variants.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';
import { runSmsOtpFlow } from './SmsOtpFlow.js';
import {
  formatAuthValue,
  makeWarmArgs,
  pickWarmSeed,
  readCredsString,
} from './TokenStrategyFromConfig.shared.js';
import type {
  GenericCreds,
  IFlowCapture,
  ILongTermTokenSlot,
  IPrimeArgs,
  IRunFlowArgs,
} from './TokenStrategyFromConfig.types.js';

/**
 * Build IRunSmsOtpArgs payload from IRunFlowArgs (passthrough).
 * @param args - Outer run-flow args.
 * @returns Inner SmsOtp run args.
 */
function toFlowArgs(args: IRunFlowArgs): Parameters<typeof runSmsOtpFlow>[0] {
  return {
    config: args.config,
    bus: args.bus,
    creds: args.creds,
    companyId: args.companyId,
    initialCarry: args.initialCarry,
    startStepIndex: args.startStepIndex,
  };
}

/**
 * Capture the flow's long-term token + carry snapshot into the slot.
 * @param slot - Capture slot.
 * @param result - Captured flow outputs (longTermToken + carrySnapshot).
 * @returns true for chaining.
 */
function captureFlowResult(slot: ILongTermTokenSlot, result: IFlowCapture): true {
  if (result.longTermToken.length > 0) slot.latest = result.longTermToken;
  slot.latestCarrySnapshot = result.carrySnapshot;
  return true;
}

/** Inputs for {@link finishFlow}. */
interface IFinishFlowArgs {
  readonly args: IRunFlowArgs;
  readonly slot: ILongTermTokenSlot;
  readonly result: IFlowCapture & { bearer: string };
}

/**
 * Capture + format the SMS-OTP success result.
 * @param input - Run args, slot, and successful flow result.
 * @returns Authorization header value.
 */
function finishFlow(input: IFinishFlowArgs): string {
  captureFlowResult(input.slot, input.result);
  return formatAuthValue(input.args.config, input.result.bearer);
}

/**
 * Run SmsOtpFlow, capture the long-term token into the slot, and wrap
 * the bearer per authScheme.
 * @param args - Run args.
 * @param slot - Mutable capture slot.
 * @returns Formatted Authorization header value procedure.
 */
async function runConfiguredFlow(
  args: IRunFlowArgs,
  slot: ILongTermTokenSlot,
): Promise<Procedure<string>> {
  const flowArgs = toFlowArgs(args);
  const flowProc = await runSmsOtpFlow(flowArgs);
  if (!isOk(flowProc)) return flowProc;
  const headerValue = finishFlow({ args, slot, result: flowProc.value });
  return succeed(headerValue);
}

/**
 * primeInitial — warm-start short-circuit; else cold flow.
 * @param args - Config + bus + ctx + creds + capture slot.
 * @returns Header-value procedure.
 */
async function primeInitialImpl(args: IPrimeArgs): Promise<Procedure<string>> {
  const { config, bus, ctx, creds, slot } = args;
  const stored = pickWarmSeed(config, creds);
  slot.usedWarmPath = stored !== false;
  if (stored === false) {
    return runConfiguredFlow({ config, bus, creds, companyId: ctx.companyId }, slot);
  }
  const warmArgs = makeWarmArgs({ config, bus, creds, stored, companyId: ctx.companyId });
  return runConfiguredFlow(warmArgs, slot);
}

/**
 * primeFresh — always runs the cold flow.
 * @param args - Config + bus + ctx + creds + capture slot.
 * @returns Header-value procedure.
 */
async function primeFreshImpl(args: IPrimeArgs): Promise<Procedure<string>> {
  const { config, bus, ctx, creds, slot } = args;
  slot.usedWarmPath = false;
  return runConfiguredFlow({ config, bus, creds, companyId: ctx.companyId }, slot);
}

/**
 * hasWarmState — non-empty creds[warmStart.credsField].
 * @param config - Config literal.
 * @param creds - Caller credentials.
 * @returns Warm-state flag.
 */
function hasWarmStateImpl(config: IApiDirectCallConfig, creds: GenericCreds): boolean {
  if (config.warmStart === undefined) return false;
  return readCredsString(creds, config.warmStart.credsField).length > 0;
}

export { hasWarmStateImpl, primeFreshImpl, primeInitialImpl, runConfiguredFlow };
