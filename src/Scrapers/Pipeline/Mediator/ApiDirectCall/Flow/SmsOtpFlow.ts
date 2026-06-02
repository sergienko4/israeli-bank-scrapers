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
import { buildInitialCarry } from './FlowInitCarry.js';
import type { IStepCookieJar } from './RunStep.js';
import { createSimpleCookieJar, runStep } from './RunStep.js';

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
 * Generate both EC and RSA keypairs when config.signer is present
 * and asymmetric. AES (symmetric) signers don't need a keypair —
 * the signing key bytes come from `config.secrets.<name>` via
 * `keyRef`. Banks whose fingerprint/body reference only one
 * asymmetric algorithm can ignore the other; generation is cheap.
 * @param config - API-direct-call config.
 * @returns Procedure with keypair bundle (empty when no signer or AES).
 */
function prepareKeypairs(config: IApiDirectCallConfig): Procedure<IKeypairBundle> {
  if (config.signer === undefined) return succeed({});
  if (config.signer.algorithm === 'AES-CBC-PKCS7') return succeed({});
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
 * Build the standard preHook-throw failure procedure.
 * @param hook - Pre-step hook config.
 * @param message - Error message text.
 * @returns Procedure failure.
 */
function preHookThrowFail(hook: IPreStepHook, message: string): Procedure<string> {
  return fail(
    ScraperErrorTypes.Generic,
    `preHook: creds.${hook.awaitCredsField}() threw: ${message}`,
  );
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
  } catch (error) {
    const message = toErrorMessage(error as Error);
    return preHookThrowFail(hook, message);
  }
}

/**
 * Build the standard preHook missing-function failure procedure.
 * @param hook - Pre-step hook config.
 * @returns Procedure failure.
 */
function preHookMissingFnFail(hook: IPreStepHook): Procedure<ITemplateScope> {
  return fail(
    ScraperErrorTypes.TwoFactorRetrieverMissing,
    `preHook: creds.${hook.awaitCredsField} is not a function`,
  );
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
  if (typeof fn !== 'function') return preHookMissingFnFail(hook);
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
 * Build the runStep payload for the current iteration.
 * @param args - Step-reduce shared args.
 * @param step - Step config.
 * @param scope - Resolved scope for this iteration.
 * @returns runStep input bundle.
 */
function makeRunStepArgs(
  args: IStepReduceArgs,
  step: IApiDirectCallConfig['steps'][number],
  scope: ITemplateScope,
): Parameters<typeof runStep>[0] {
  return {
    step,
    bus: args.bus,
    scope,
    companyId: args.companyId,
    signingKeypair: args.keypair,
    cookieJar: args.cookieJar,
  };
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
  const stepArgs = makeRunStepArgs(args, step, hooked.value);
  return runStep(stepArgs);
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
  /**
   * Frozen snapshot of the flow's final `scope.carry`. Lets the
   * calling action handler propagate bank-specific identifiers
   * (e.g. `uId`, `deviceId16Hex`) into the {@link IApiMediator}
   * session context so the scrape phase can read them back via
   * `getSessionContext()`.
   */
  readonly carrySnapshot: Readonly<Record<string, JsonValue>>;
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
): string {
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

/** Prepared inputs for the seedScope + reduce passes. */
interface ISmsOtpPrep {
  readonly keypairs: IKeypairBundle;
  readonly fingerprint: ICollectionResult | false;
  readonly initialCarry: Readonly<Record<string, JsonValue>>;
}

/**
 * Build the initial carry (system seed + caller initialCarry merged
 * via buildInitialCarry).
 * @param args - Flow run args.
 * @returns Initial carry procedure.
 */
function buildSmsOtpCarry(args: IRunSmsOtpArgs): Procedure<Readonly<Record<string, JsonValue>>> {
  const baseSeed: Record<string, JsonValue> = { flowId: randomUUID() };
  const merged = mergeInitialCarry(baseSeed, args);
  return buildInitialCarry(args.config, args.creds, merged);
}

/** Core inputs prepared before the initial carry — keypairs + fingerprint. */
interface ICoreSmsOtpInputs {
  readonly keypairs: IKeypairBundle;
  readonly fingerprint: ICollectionResult | false;
}

/**
 * Prepare the keypairs + fingerprint bundle (no carry build).
 * @param args - Flow run args.
 * @returns Core inputs procedure.
 */
function prepCoreInputs(args: IRunSmsOtpArgs): Procedure<ICoreSmsOtpInputs> {
  const keypairsProc = prepareKeypairs(args.config);
  if (!isOk(keypairsProc)) return keypairsProc;
  const fpProc = prepareFingerprint(args.config);
  if (!isOk(fpProc)) return fpProc;
  return succeed({ keypairs: keypairsProc.value, fingerprint: fpProc.value });
}

/**
 * Prepare keypairs, fingerprint, and initial carry for the flow.
 * @param args - Flow run args.
 * @returns Prepared bundle procedure.
 */
function prepareSmsOtpFlow(args: IRunSmsOtpArgs): Procedure<ISmsOtpPrep> {
  const coreProc = prepCoreInputs(args);
  if (!isOk(coreProc)) return coreProc;
  const carryProc = buildSmsOtpCarry(args);
  if (!isOk(carryProc)) return carryProc;
  return succeed({ ...coreProc.value, initialCarry: carryProc.value });
}

/**
 * Build the ISeedArgs payload from flow args + prep.
 * @param args - Flow run args.
 * @param prep - Prepared inputs.
 * @returns Seed args.
 */
function makeSeedArgs(args: IRunSmsOtpArgs, prep: ISmsOtpPrep): ISeedArgs {
  return {
    config: args.config,
    creds: args.creds,
    keypairs: prep.keypairs,
    fingerprint: prep.fingerprint,
    initialCarry: prep.initialCarry,
  };
}

/**
 * Build the IStepReduceArgs payload from flow args + prep.
 * @param args - Flow run args.
 * @param prep - Prepared inputs.
 * @returns Step-reduce args.
 */
function buildReduceArgs(args: IRunSmsOtpArgs, prep: ISmsOtpPrep): IStepReduceArgs {
  return {
    bus: args.bus,
    companyId: args.companyId,
    keypair: prep.keypairs.ec,
    creds: args.creds,
    cookieJar: createSimpleCookieJar(),
  };
}

/**
 * Build the IReduceStepsArgs payload.
 * @param args - Flow run args.
 * @param reduceArgs - Per-step shared args.
 * @param initial - Seed scope.
 * @returns Reduce-steps args.
 */
function makeReduceStepsArgs(
  args: IRunSmsOtpArgs,
  reduceArgs: IStepReduceArgs,
  initial: ITemplateScope,
): IReduceStepsArgs {
  return {
    steps: args.config.steps,
    startIndex: args.startStepIndex ?? 0,
    reduceArgs,
    initial,
  };
}

/**
 * Drive the full step reduction (seed → reduceArgs → reduce).
 * @param args - Flow run args.
 * @param prep - Prepared inputs.
 * @returns Final scope procedure.
 */
async function reduceAllSteps(
  args: IRunSmsOtpArgs,
  prep: ISmsOtpPrep,
): Promise<Procedure<ITemplateScope>> {
  const seedArgs = makeSeedArgs(args, prep);
  const initial = seedScope(seedArgs);
  const reduceArgs = buildReduceArgs(args, prep);
  const reduceStepsArgs = makeReduceStepsArgs(args, reduceArgs, initial);
  return reduceSteps(reduceStepsArgs);
}

/**
 * Build the final IFlowResult after step reduction.
 * @param scope - Final scope.
 * @param config - Bank config.
 * @param bearer - Extracted bearer token.
 * @returns Flow result bundle.
 */
function buildFlowResult(
  scope: ITemplateScope,
  config: IApiDirectCallConfig,
  bearer: string,
): IFlowResult {
  const longTermToken = extractLongTermTokenFromCarry(config, scope);
  const carrySnapshot = Object.freeze({ ...scope.carry });
  return { bearer, longTermToken, carrySnapshot };
}

/**
 * Run the sms-otp flow end-to-end.
 * @param args - Run args.
 * @returns Procedure with { bearer, longTermToken }.
 */
async function runSmsOtpFlow(args: IRunSmsOtpArgs): Promise<Procedure<IFlowResult>> {
  const prepProc = prepareSmsOtpFlow(args);
  if (!isOk(prepProc)) return prepProc;
  const finalProc = await reduceAllSteps(args, prepProc.value);
  if (!isOk(finalProc)) return finalProc;
  const bearerProc = extractTokenFromCarry(finalProc.value);
  if (!isOk(bearerProc)) return bearerProc;
  const result = buildFlowResult(finalProc.value, args.config, bearerProc.value);
  return succeed(result);
}

export type { IFlowResult, IRunSmsOtpArgs };
export { runSmsOtpFlow };
