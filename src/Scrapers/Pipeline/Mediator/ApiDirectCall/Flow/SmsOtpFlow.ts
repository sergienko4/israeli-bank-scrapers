/**
 * SmsOtpFlow — the generic orchestrator for the 'sms-otp' flow-kind.
 * Reads an IApiDirectCallConfig + raw creds and walks config.steps
 * through RunStep, threading scope.carry forward. Emits the final
 * Authorization header value as a Procedure<string>.
 *
 * Supports optional initial-carry + start-step-index (warm-start) and
 * per-step preHook (awaits a creds callback before the step fires —
 * used by OTP retrievers).
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { randomUUID } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { resolveWkUrl } from '../../../Registry/WK/UrlsWK.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiMediator } from '../../Api/ApiMediator.js';
import type { IGenericKeypair } from '../Crypto/CryptoKeyFactory.js';
import { generateKeypair } from '../Crypto/CryptoKeyFactory.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { ICollectionResult } from '../Fingerprint/GenericFingerprintBuilder.js';
import { buildCollectionResult } from '../Fingerprint/GenericFingerprintBuilder.js';
import type { IApiDirectCallConfig, IPreStepHook } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import type { IStepCookieJar } from './RunStep.js';
import { createSimpleCookieJar, runStep } from './RunStep.js';

/** Reusable long-term token captured from carry per config.warmStart. */
type LongTermToken = string;

/** Args bundle for runSmsOtpFlow — respects the 3-param ceiling. */
interface IRunSmsOtpArgs {
  readonly config: IApiDirectCallConfig;
  readonly bus: IApiMediator;
  readonly creds: Readonly<Record<string, unknown>>;
  readonly companyId: Parameters<typeof resolveWkUrl>[1];
  /** Optional initial carry — used by warm-start short-circuit. */
  readonly initialCarry?: Readonly<Record<string, JsonValue>>;
  /** First step index to iterate from (0 = cold path). */
  readonly startStepIndex?: number;
}

/** Keypair bundle handed to RunStep per step. */
type SigningKeypair = IGenericKeypair | undefined;

/** Scope-bound keypair pair (both may be undefined when no signer). */
interface IKeypairBundle {
  readonly ec?: IGenericKeypair;
  readonly rsa?: IGenericKeypair;
}

/**
 * Generate both EC and RSA keypairs when config.signer is present.
 * Banks whose fingerprint/body reference only one can ignore the
 * other; generation is cheap and keeps bank surfaces data-only.
 * @param config - API-direct-call config.
 * @returns Procedure with keypair bundle (empty when no signer).
 */
function prepareKeypairs(config: IApiDirectCallConfig): Procedure<IKeypairBundle> {
  if (config.signer === undefined) return succeed({});
  const ecProc = generateKeypair('ECDSA-P256');
  if (!isOk(ecProc)) return ecProc;
  const rsaProc = generateKeypair('RSA-2048');
  if (!isOk(rsaProc)) return rsaProc;
  return succeed({ ec: ecProc.value, rsa: rsaProc.value });
}

/**
 * Build the fingerprint collection block when config.fingerprint is set.
 * @param config - API-direct-call config.
 * @returns Procedure with the collection result (or false when absent).
 */
function prepareFingerprint(config: IApiDirectCallConfig): Procedure<ICollectionResult | false> {
  if (config.fingerprint === undefined) return succeed(false);
  return buildCollectionResult(config.fingerprint, config);
}

/** Seed for the step-reduction — carry/keypair/fingerprint-ready scope. */
interface ISeedArgs {
  readonly config: IApiDirectCallConfig;
  readonly creds: Readonly<Record<string, unknown>>;
  readonly keypairs: IKeypairBundle;
  readonly fingerprint: ICollectionResult | false;
  readonly initialCarry: Readonly<Record<string, JsonValue>>;
}

/**
 * Build the partial-slot set for the scope (only sets what's present).
 * @param keypairs - Generated keypair bundle.
 * @param fp - Fingerprint result or false.
 * @returns Partial scope containing only the present slots.
 */
function buildScopeSlots(
  keypairs: IKeypairBundle,
  fp: ICollectionResult | false,
): Pick<ITemplateScope, 'keypair' | 'fingerprint'> {
  const hasKeys = keypairs.ec !== undefined || keypairs.rsa !== undefined;
  const slots: { keypair?: IKeypairBundle; fingerprint?: ICollectionResult } = {};
  if (hasKeys) slots.keypair = keypairs;
  if (fp !== false) slots.fingerprint = fp;
  return slots;
}

/**
 * Seed the template scope for the first step.
 * @param args - Seed args.
 * @returns Initial scope.
 */
function seedScope(args: ISeedArgs): ITemplateScope {
  const slots = buildScopeSlots(args.keypairs, args.fingerprint);
  return {
    carry: { ...args.initialCarry },
    creds: args.creds,
    config: args.config,
    ...slots,
  };
}

/** Args bundle for coercePreHookResult — keeps param type concrete. */
interface IPreHookCoerceArgs {
  readonly raw: JsonValue;
  readonly hook: IPreStepHook;
}

/**
 * Coerce the pre-hook callback return to a string Procedure.
 * @param args - Raw value + hook bundle.
 * @returns Procedure with the string or a fail.
 */
function coercePreHookResult(args: IPreHookCoerceArgs): Procedure<string> {
  if (typeof args.raw !== 'string') {
    return fail(
      ScraperErrorTypes.Generic,
      `preHook: creds.${args.hook.awaitCredsField}() did not return a string`,
    );
  }
  return succeed(args.raw);
}

/**
 * Invoke the creds callback and coerce the result to a string.
 * @param fn - The bound creds function.
 * @param hook - Hook config (used only for diagnostics).
 * @returns Procedure with the string result or a fail.
 */
async function invokePreHookFn(
  fn: () => Promise<unknown>,
  hook: IPreStepHook,
): Promise<Procedure<string>> {
  try {
    const raw = (await fn()) as JsonValue;
    return coercePreHookResult({ raw, hook });
  } catch (err) {
    const message = toErrorMessage(err as Error);
    return fail(
      ScraperErrorTypes.Generic,
      `preHook: creds.${hook.awaitCredsField}() threw: ${message}`,
    );
  }
}

/**
 * Await the creds function named in preHook and deposit the string
 * result into carry[intoCarryField]. Non-string returns fail.
 * @param scope - Current scope.
 * @param creds - Caller credentials.
 * @param hook - Pre-step hook config.
 * @returns Updated scope or fail.
 */
async function applyPreHook(
  scope: ITemplateScope,
  creds: Readonly<Record<string, unknown>>,
  hook: IPreStepHook,
): Promise<Procedure<ITemplateScope>> {
  const fn = creds[hook.awaitCredsField];
  if (typeof fn !== 'function') {
    return fail(
      ScraperErrorTypes.TwoFactorRetrieverMissing,
      `preHook: creds.${hook.awaitCredsField} is not a function`,
    );
  }
  const valueProc = await invokePreHookFn(fn as () => Promise<unknown>, hook);
  if (!isOk(valueProc)) return valueProc;
  const nextCarry = { ...scope.carry, [hook.intoCarryField]: valueProc.value };
  return succeed({ ...scope, carry: nextCarry });
}

/** Args-reducer bundle — passed through every step. */
interface IStepReduceArgs {
  readonly bus: IApiMediator;
  readonly companyId: Parameters<typeof resolveWkUrl>[1];
  readonly keypair: SigningKeypair;
  readonly creds: Readonly<Record<string, unknown>>;
  readonly cookieJar: IStepCookieJar;
}

/**
 * Resolve the scope to use for a step — applies preHook when present.
 * @param args - Reduce args.
 * @param scope - Current scope.
 * @param step - Next step config.
 * @returns Updated scope procedure.
 */
async function resolveStepScope(
  args: IStepReduceArgs,
  scope: ITemplateScope,
  step: IApiDirectCallConfig['steps'][number],
): Promise<Procedure<ITemplateScope>> {
  if (step.preHook === undefined) return succeed(scope);
  return applyPreHook(scope, args.creds, step.preHook);
}

/**
 * Run preHook (if any) then runStep.
 * @param args - Reduce args.
 * @param scope - Current scope.
 * @param step - Next step config.
 * @returns Updated scope procedure.
 */
async function runOneStep(
  args: IStepReduceArgs,
  scope: ITemplateScope,
  step: IApiDirectCallConfig['steps'][number],
): Promise<Procedure<ITemplateScope>> {
  const hooked = await resolveStepScope(args, scope, step);
  if (!isOk(hooked)) return hooked;
  return runStep({
    step,
    bus: args.bus,
    scope: hooked.value,
    companyId: args.companyId,
    signingKeypair: args.keypair,
    cookieJar: args.cookieJar,
  });
}

/** Bundle of reducer inputs — keeps reduceSteps at ≤3 params. */
interface IReduceStepsArgs {
  readonly steps: IApiDirectCallConfig['steps'];
  readonly startIndex: number;
  readonly reduceArgs: IStepReduceArgs;
  readonly initial: ITemplateScope;
}

/**
 * Reduce every step sequentially starting from startIndex.
 * @param args - Reducer args bundle.
 * @param index - Current iteration index (pass startIndex to begin).
 * @param acc - Accumulated procedure (pass succeed(initial)).
 * @returns Final scope procedure (or first-failure short-circuit).
 */
async function reduceStepsAt(
  args: IReduceStepsArgs,
  index: number,
  acc: Procedure<ITemplateScope>,
): Promise<Procedure<ITemplateScope>> {
  if (!isOk(acc)) return acc;
  if (index >= args.steps.length) return acc;
  const next = await runOneStep(args.reduceArgs, acc.value, args.steps[index]);
  return reduceStepsAt(args, index + 1, next);
}

/**
 * Reduce every step sequentially starting from startIndex.
 * @param args - Reducer args bundle.
 * @returns Final scope procedure (or first-failure short-circuit).
 */
function reduceSteps(args: IReduceStepsArgs): Promise<Procedure<ITemplateScope>> {
  const seed: Procedure<ITemplateScope> = succeed(args.initial);
  return reduceStepsAt(args, args.startIndex, seed);
}

/** Result returned by a successful sms-otp flow. */
interface IFlowResult {
  /** Final bearer token (carry.token) installed via ApiMediator.setRawAuth. */
  readonly bearer: string;
  /**
   * Long-term reusable token (carry[config.warmStart.carryField]) —
   * empty string when config.warmStart is not configured.
   */
  readonly longTermToken: string;
}

/**
 * Extract the bearer token string from the final scope's carry.
 * @param scope - Final scope.
 * @returns Procedure with the bearer token value.
 */
function extractTokenFromCarry(scope: ITemplateScope): Procedure<string> {
  const token: JsonValue | false = scope.carry.token ?? false;
  if (typeof token !== 'string' || token.length === 0) {
    return fail(ScraperErrorTypes.Generic, 'sms-otp flow produced no carry.token');
  }
  return succeed(token);
}

/**
 * Read the long-term token from the final carry per config.warmStart.
 * Returns empty string when no warmStart is configured or when the
 * carry field is absent/non-string.
 * @param config - API-direct-call config.
 * @param scope - Final scope.
 * @returns Long-term token or ''.
 */
function extractLongTermTokenFromCarry(
  config: IApiDirectCallConfig,
  scope: ITemplateScope,
): LongTermToken {
  const warm = config.warmStart;
  if (warm === undefined) return '';
  const value = scope.carry[warm.carryField];
  if (typeof value !== 'string') return '';
  return value;
}

/**
 * Merge the provided warm-start carry (if any) over the base seed.
 * @param baseSeed - System-generated carry (flowId etc).
 * @param args - Flow args (for access to initialCarry).
 * @returns Merged readonly carry.
 */
function mergeInitialCarry(
  baseSeed: Record<string, JsonValue>,
  args: IRunSmsOtpArgs,
): Readonly<Record<string, JsonValue>> {
  if (args.initialCarry === undefined) return baseSeed;
  return { ...baseSeed, ...args.initialCarry };
}

/**
 * Run the sms-otp flow end-to-end.
 * @param args - Run args.
 * @returns Procedure with { bearer, longTermToken }.
 */
async function runSmsOtpFlow(args: IRunSmsOtpArgs): Promise<Procedure<IFlowResult>> {
  const keypairsProc = prepareKeypairs(args.config);
  if (!isOk(keypairsProc)) return keypairsProc;
  const fpProc = prepareFingerprint(args.config);
  if (!isOk(fpProc)) return fpProc;
  const baseSeed: Record<string, JsonValue> = { flowId: randomUUID() };
  const mergedInitialCarry = mergeInitialCarry(baseSeed, args);
  const initial = seedScope({
    config: args.config,
    creds: args.creds,
    keypairs: keypairsProc.value,
    fingerprint: fpProc.value,
    initialCarry: mergedInitialCarry,
  });
  const reduceArgs: IStepReduceArgs = {
    bus: args.bus,
    companyId: args.companyId,
    keypair: keypairsProc.value.ec,
    creds: args.creds,
    cookieJar: createSimpleCookieJar(),
  };
  const startIndex = args.startStepIndex ?? 0;
  const finalProc = await reduceSteps({
    steps: args.config.steps,
    startIndex,
    reduceArgs,
    initial,
  });
  if (!isOk(finalProc)) return finalProc;
  const bearerProc = extractTokenFromCarry(finalProc.value);
  if (!isOk(bearerProc)) return bearerProc;
  const longTermToken = extractLongTermTokenFromCarry(args.config, finalProc.value);
  return succeed({ bearer: bearerProc.value, longTermToken });
}

export type { IFlowResult, IRunSmsOtpArgs };
export { runSmsOtpFlow };
