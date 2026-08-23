/**
 * Shared types + arg bundles for the SmsOtpFlow cluster.
 */

import type { resolveWkUrl } from '../../../Registry/WK/UrlsWK.js';
import type { ITokenBus } from '../../../Types/Domain/TokenBus.js';
import type { Procedure } from '../../../Types/Procedure.js';
import type { IApiDirectCallConfig, IPreStepHook } from '../ConfigContracts/index.js';
import type { IGenericKeypair } from '../Crypto/CryptoKeyFactory.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { ICollectionResult } from '../Fingerprint/GenericFingerprintBuilder.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import type { IStepCookieJar } from './RunStep.js';

/**
 * Flow-scoped preHook acquisition state.
 *
 * <p>`pending` memoises acquisitions; `counts` tracks how many times each
 * credential field has been requested during this flow so a failure can name
 * its ordinal. Behaviour lives in `SmsOtpFlow.prehookCache.ts`; the shape lives
 * here so that module and `SmsOtpFlow.prehookInvoke.ts` stay acyclic.
 */
interface IPreHookCache {
  readonly pending: Map<string, Promise<Procedure<string>>>;
  readonly counts: Map<string, number>;
}

/** Args bundle for cache-backed acquisition — respects the 3-param ceiling. */
interface IPreHookAcquireArgs {
  readonly cache: IPreHookCache;
  readonly hook: IPreStepHook;
  readonly fn: () => Promise<unknown>;
}

/** Args bundle for runSmsOtpFlow — respects the 3-param ceiling. */
interface IRunSmsOtpArgs {
  readonly config: IApiDirectCallConfig;
  readonly bus: ITokenBus;
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

/** Seed for the step-reduction — carry/keypair/fingerprint-ready scope. */
interface ISeedArgs {
  readonly config: IApiDirectCallConfig;
  readonly creds: Readonly<Record<string, unknown>>;
  readonly keypairs: IKeypairBundle;
  readonly fingerprint: ICollectionResult | false;
  readonly initialCarry: Readonly<Record<string, JsonValue>>;
}

/** Coercion bundle for the pre-hook raw return. */
interface IPreHookCoerceArgs {
  readonly raw: JsonValue;
  readonly hook: IPreStepHook;
}

/** Args bundle for invokePreHookFn — keeps the signature single-line. */
interface IInvokePreHookArgs {
  readonly fn: () => Promise<unknown>;
  readonly hook: IPreStepHook;
  /** 1-based ordinal of this invocation within the flow (for diagnostics). */
  readonly invocation: number;
}

/** Args bundle for applyPreHook — keeps the signature single-line. */
interface IApplyPreHookArgs {
  readonly scope: ITemplateScope;
  readonly creds: Readonly<Record<string, unknown>>;
  readonly hook: IPreStepHook;
  /** Flow-scoped acquisition cache — one delivered secret, one prompt. */
  readonly cache: IPreHookCache;
}

/** Args-reducer bundle — passed through every step. */
interface IStepReduceArgs {
  readonly bus: ITokenBus;
  readonly companyId: Parameters<typeof resolveWkUrl>[1];
  readonly keypair: SigningKeypair;
  readonly creds: Readonly<Record<string, unknown>>;
  readonly cookieJar: IStepCookieJar;
  /** Created once per flow, discarded with it. See SmsOtpFlow.prehookCache. */
  readonly preHookCache: IPreHookCache;
}

/** Args bundle for makeRunStepArgs — keeps the signature single-line. */
interface IMakeRunStepArgs {
  readonly args: IStepReduceArgs;
  readonly step: IApiDirectCallConfig['steps'][number];
  readonly scope: ITemplateScope;
}

/** Bundle of reducer inputs — keeps reduceSteps at ≤3 params. */
interface IReduceStepsArgs {
  readonly steps: IApiDirectCallConfig['steps'];
  readonly startIndex: number;
  readonly reduceArgs: IStepReduceArgs;
  readonly initial: ITemplateScope;
}

/** Result returned by a successful sms-otp flow. */
interface IFlowResult {
  readonly bearer: string;
  readonly longTermToken: string;
  readonly carrySnapshot: Readonly<Record<string, JsonValue>>;
}

/** Prepared inputs for the seedScope + reduce passes. */
interface ISmsOtpPrep {
  readonly keypairs: IKeypairBundle;
  readonly fingerprint: ICollectionResult | false;
  readonly initialCarry: Readonly<Record<string, JsonValue>>;
}

/** Core inputs prepared before the initial carry — keypairs + fingerprint. */
interface ICoreSmsOtpInputs {
  readonly keypairs: IKeypairBundle;
  readonly fingerprint: ICollectionResult | false;
}

/** Args bundle for makeReduceStepsArgs — keeps the signature single-line. */
interface IMakeReduceStepsArgs {
  readonly args: IRunSmsOtpArgs;
  readonly reduceArgs: IStepReduceArgs;
  readonly initial: ITemplateScope;
}
export type {
  IApplyPreHookArgs,
  ICoreSmsOtpInputs,
  IFlowResult,
  IInvokePreHookArgs,
  IKeypairBundle,
  IMakeReduceStepsArgs,
  IMakeRunStepArgs,
  IPreHookAcquireArgs,
  IPreHookCache,
  IPreHookCoerceArgs,
  IReduceStepsArgs,
  IRunSmsOtpArgs,
  ISeedArgs,
  ISmsOtpPrep,
  IStepReduceArgs,
  SigningKeypair,
};
