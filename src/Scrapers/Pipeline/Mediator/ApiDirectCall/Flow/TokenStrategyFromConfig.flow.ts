/**
 * Flow execution helpers for TokenStrategyFromConfig:
 * runs the configured SMS-OTP flow, captures the long-term token,
 * and implements the warm/cold prime variants.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { getDebug } from '../../../Logging/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import { formatAuthValue } from './AuthModePolicy.js';
import { runSmsOtpFlow } from './SmsOtpFlow.js';
import { admitFlow, isColdStart } from './TokenStrategyFromConfig.budget.js';
import { primeDurable, refuseDurableRefresh } from './TokenStrategyFromConfig.persistent.js';
import { isWarmSeedSupplied, makeWarmArgs } from './TokenStrategyFromConfig.shared.js';
import type {
  IFlowCapture,
  ILongTermTokenSlot,
  IMakeWarmArgs,
  IPrimeArgs,
  IRunFlowArgs,
  IWarmSeedVerdict,
} from './TokenStrategyFromConfig.types.js';
import {
  exportWarmToken,
  prepareColdStart,
  restoreWarmSeed,
} from './TokenStrategyFromConfig.warm.js';
import { cookieJarWarmOf } from './WarmStartKind.js';

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
 * @param isJar - Whether even an empty jar export replaces the previous token.
 * @returns true for chaining.
 */
function captureFlowResult(slot: ILongTermTokenSlot, result: IFlowCapture, isJar: boolean): true {
  if (result.longTermToken.length > 0 || isJar) slot.latest = result.longTermToken;
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
 * Capture + format the SMS-OTP success result. The long-term token captured
 * is the one the warm-start kind publishes.
 * @param input - Run args, slot, and successful flow result.
 * @returns Authorization header value.
 */
function finishFlow(input: IFinishFlowArgs): string {
  const longTermToken = exportWarmToken(input.args, input.result.longTermToken);
  const isJar = cookieJarWarmOf(input.args.config) !== false;
  captureFlowResult(input.slot, { ...input.result, longTermToken }, isJar);
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
  'this scrape has already spent its one cold login; the session cannot ' +
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
  LOG.warn(meta, 'Cold-login budget spent — refusing a second cold login this run');
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
 *
 * <p>Required credentials are checked before the charge (`admitFlow`). A flow
 * that fails them sends nothing, so it spends nothing, and a later retry names
 * the bad field rather than the spent budget.
 * An admitted cold start then resets what the warm-start kind left behind;
 * a refused refresh keeps the live session.
 * @param args - Run args.
 * @param slot - Mutable capture slot.
 * @returns Formatted Authorization header value procedure.
 */
async function runConfiguredFlow(
  args: IRunFlowArgs,
  slot: ILongTermTokenSlot,
): Promise<Procedure<string>> {
  const admitted = admitFlow(args, slot);
  if (!isOk(admitted)) return admitted;
  if (!admitted.value) return answerRefusedFlow(args, slot);
  prepareColdStart(args);
  return runFlowAndCapture(args, slot);
}

/**
 * Run the warm attempt, recording why it failed when it does.
 *
 * <p>`TokenResolverBuilder` retries the cold flow on any primeInitial failure
 * except a WAF block — a bank refusal, but equally a timeout or a transport
 * error. It discards the failure on the way, so unless it is captured here the
 * fallback warning has nothing left to name and can only assume.
 *
 * <p>Only the error *tag* is kept. `errorMessage` is not safe to carry into an
 * operator-facing log: banks echo credentials into it, which is what
 * `redactErrorMessage` exists to stop.
 * @param warmSpec - Config, bus, creds, the restored carry and the company id.
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
 * Classify the caller's warm seed for this prime cycle.
 * @param args - Config + creds.
 * @param isAccepted - Whether the seed passed the local restoration checks.
 * @returns Whether a seed was supplied and whether it will be sent.
 */
function warmSeedVerdictOf(args: IPrimeArgs, isAccepted: boolean): IWarmSeedVerdict {
  const isSupplied = isWarmSeedSupplied(args.config, args.creds);
  return { supplied: isSupplied, accepted: isAccepted };
}

/**
 * Reset every per-prime verdict on the slot before a new attempt runs.
 *
 * <p>The failure tag deliberately survives `primeFresh`, because the cold
 * retry that `TokenResolverBuilder` fires straight after a failed warm attempt
 * is exactly when the fallback warning reads it. That longevity is why the
 * reset has to happen here: otherwise a later, healthy prime would still
 * report a tag belonging to a cycle that has already been superseded.
 * @param args - Config + creds + mutable capture slot.
 * @param isAccepted - Whether the seed passed the local restoration checks.
 * @returns true (ack contract).
 */
function openPrimeCycle(args: IPrimeArgs, isAccepted: boolean): true {
  const seed = warmSeedVerdictOf(args, isAccepted);
  args.slot.usedWarmPath = seed.accepted;
  args.slot.warmSeedRejectedLocally = seed.supplied && !seed.accepted;
  args.slot.warmAttemptFailureType = undefined;
  return true;
}

/**
 * primeInitial — durable branch when opted in; else warm-start
 * short-circuit; else cold flow.
 * @param args - Config + bus + ctx + creds + capture slot.
 * @returns Header-value procedure.
 */
async function primeInitialImpl(args: IPrimeArgs): Promise<Procedure<string>> {
  const durable = args.slot.persistentAuth;
  if (durable !== undefined) return primeDurable(args, durable);
  const { config, bus, ctx, creds, slot } = args;
  const flowBase = { config, bus, creds, companyId: ctx.companyId };
  const initialCarry = restoreWarmSeed({ config, bus, creds });
  openPrimeCycle(args, initialCarry !== false);
  if (initialCarry === false) return runConfiguredFlow(flowBase, slot);
  return runWarmAttempt({ ...flowBase, initialCarry }, slot);
}

/**
 * primeFresh — always runs the cold flow, except in durable mode, which
 * refuses locally so a rejected session never re-mints mid-run.
 * @param args - Config + bus + ctx + creds + capture slot.
 * @returns Header-value procedure.
 */
async function primeFreshImpl(args: IPrimeArgs): Promise<Procedure<string>> {
  const { config, bus, ctx, creds, slot } = args;
  if (slot.persistentAuth !== undefined) return refuseDurableRefresh(args);
  slot.usedWarmPath = false;
  return runConfiguredFlow({ config, bus, creds, companyId: ctx.companyId }, slot);
}

/**
 * hasWarmState — retry eligibility: true only when the failed initial prime
 * took the warm path with an accepted seed. A locally rejected seed already
 * ran cold, so a second cold flow would only mask the first failure. The fallback warning
 * reads `warmSeedRejectedLocally` / `warmAttemptFailureType` instead. The
 * verdict comes from the recorded prime cycle, never from re-read creds.
 * @param slot - Capture slot holding the durable mode and the cycle verdict.
 * @returns Warm-state flag.
 */
function hasWarmStateImpl(slot: ILongTermTokenSlot): boolean {
  if (slot.persistentAuth !== undefined) return false;
  return slot.usedWarmPath === true;
}

export {
  BUDGET_SPENT_MESSAGE,
  hasWarmStateImpl,
  primeFreshImpl,
  primeInitialImpl,
  runConfiguredFlow,
};
