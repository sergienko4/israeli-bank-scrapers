/**
 * Flow execution helpers for TokenStrategyFromConfig:
 * runs the configured SMS-OTP flow, captures the long-term token,
 * and implements the warm/cold prime variants.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { getDebug } from '../../../Logging/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiDirectCallConfig } from '../ConfigContracts/index.js';
import { runSmsOtpFlow } from './SmsOtpFlow.js';
import { isColdStart, mayStartFlow } from './TokenStrategyFromConfig.budget.js';
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
  IMakeWarmArgs,
  IPrimeArgs,
  IRunFlowArgs,
} from './TokenStrategyFromConfig.types.js';

const LOG = getDebug(import.meta.url);

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
  const headerValue = formatAuthValue(input.args.config, input.result.bearer);
  const isCold = isColdStart(input.args);
  if (isCold) input.slot.latestHeaderValue = headerValue;
  return headerValue;
}

/**
 * Told to the caller when the run has nothing left to offer: the one cold
 * login it was entitled to has been spent and did not yield a session.
 *
 * <p>Exported so the real-E2E harness and downstream consumers can recognise
 * a policy refusal without matching on a substring.
 */
const BUDGET_SPENT_MESSAGE =
  'this scrape has already spent its one cold SMS login; the session cannot ' +
  'be re-minted in-run — start a new scrape';

/**
 * Answer a refused cold flow without contacting the bank.
 *
 * <p>A refusal means the run has already spent its one message — so if that
 * login *succeeded*, the run owns a live bearer and the right answer is to
 * hand it back rather than fail a scrape that has everything it needs. Only
 * when no session was ever minted is there nothing to surrender.
 *
 * <p>It is logged either way. On the mainline path `retryOn401Op` discards a
 * failed refresh and returns the original 401, so without this line an
 * operator would see an unexplained rejection with no evidence that a policy
 * cap intervened — a diagnosis paid for in issue triage.
 * @param args - Run args for the refused flow.
 * @param slot - Run-scoped capture slot.
 * @returns The minted header, or the diagnosis when none exists.
 */
function answerRefusedFlow(args: IRunFlowArgs, slot: ILongTermTokenSlot): Procedure<string> {
  const minted = slot.latestHeaderValue ?? '';
  const meta = { companyId: args.companyId, hasMintedSession: minted.length > 0 };
  LOG.warn(meta, 'Cold-login budget spent — refusing a second SMS login this run');
  if (minted.length > 0) return succeed(minted);
  return fail(ScraperErrorTypes.Generic, BUDGET_SPENT_MESSAGE);
}

/**
 * Walk the configured flow and capture its long-term token into the slot.
 * @param args - Run args.
 * @param slot - Mutable capture slot.
 * @returns Formatted Authorization header value procedure.
 */
async function runFlowAndCapture(
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
 * Run SmsOtpFlow, capture the long-term token into the slot, and wrap
 * the bearer per authScheme.
 *
 * <p>Cold starts draw on the run's one-SMS budget first; a warm resume never
 * does. Refusing here, at the only place every flow passes through, covers the
 * cold prime, the warm→cold fallback, every 401-driven refresh and explicit
 * session recovery in one gate.
 * @param args - Run args.
 * @param slot - Mutable capture slot.
 * @returns Formatted Authorization header value procedure.
 */
async function runConfiguredFlow(
  args: IRunFlowArgs,
  slot: ILongTermTokenSlot,
): Promise<Procedure<string>> {
  const canStart = mayStartFlow(args, slot);
  if (!canStart) return answerRefusedFlow(args, slot);
  return runFlowAndCapture(args, slot);
}

/**
 * Run the warm attempt, recording why it failed when it does.
 *
 * <p>`TokenResolverBuilder` retries the cold flow on *any* primeInitial
 * failure — a bank refusal, but equally a timeout, a transport error or a WAF
 * block. It discards the failure on the way, so unless it is captured here the
 * fallback warning has nothing left to name and can only assume.
 *
 * <p>Only the error *tag* is kept. `errorMessage` is not safe to carry into an
 * operator-facing log: banks echo credentials into it, which is what
 * `redactErrorMessage` exists to stop.
 * @param warmSpec - Config, bus, creds, the accepted seed and the company id.
 * @param slot - Capture slot recording the outcome.
 * @returns Header-value procedure from the warm flow.
 */
async function runWarmAttempt(
  warmSpec: IMakeWarmArgs,
  slot: ILongTermTokenSlot,
): Promise<Procedure<string>> {
  const warmArgs = makeWarmArgs(warmSpec);
  const proc = await runConfiguredFlow(warmArgs, slot);
  if (!isOk(proc)) slot.warmAttemptFailureType = proc.errorType;
  return proc;
}

/**
 * Reset every per-prime verdict on the slot before a new attempt runs.
 *
 * <p>The failure tag deliberately survives `primeFresh`, because the cold
 * retry that `TokenResolverBuilder` fires straight after a failed warm attempt
 * is exactly when the fallback warning reads it. That longevity is why the
 * reset has to happen here: otherwise a later, healthy prime would still
 * report a tag belonging to a cycle that has already been superseded.
 * @param slot - Mutable capture slot.
 * @param hasSeed - Whether a seed survived the local freshness gate.
 * @returns true (ack contract).
 */
function openPrimeCycle(slot: ILongTermTokenSlot, hasSeed: boolean): true {
  slot.usedWarmPath = hasSeed;
  slot.warmSeedRejectedLocally = !hasSeed;
  slot.warmAttemptFailureType = undefined;
  return true;
}

/**
 * primeInitial — warm-start short-circuit; else cold flow.
 * @param args - Config + bus + ctx + creds + capture slot.
 * @returns Header-value procedure.
 */
async function primeInitialImpl(args: IPrimeArgs): Promise<Procedure<string>> {
  const { config, bus, ctx, creds, slot } = args;
  const flowBase = { config, bus, creds, companyId: ctx.companyId };
  const stored = pickWarmSeed(config, creds);
  openPrimeCycle(slot, stored !== false);
  if (stored === false) return runConfiguredFlow(flowBase, slot);
  return runWarmAttempt({ ...flowBase, stored }, slot);
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

export {
  BUDGET_SPENT_MESSAGE,
  hasWarmStateImpl,
  primeFreshImpl,
  primeInitialImpl,
  runConfiguredFlow,
};
