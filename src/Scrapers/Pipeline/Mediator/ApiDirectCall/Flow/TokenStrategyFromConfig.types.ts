/**
 * Type aliases + interfaces for the TokenStrategyFromConfig cluster.
 */

import type { ITokenBus } from '../../../Types/Domain/TokenBus.js';
import type { ITokenContext } from '../../../Types/Domain/TokenContext.js';
import type { ITokenStrategy } from '../../Api/ITokenStrategy.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';

/** Generic creds shape — strategies read named fields via config. */
type GenericCreds = Readonly<Record<string, unknown>>;

/**
 * Extended ITokenStrategy exposing the most recent long-term token
 * + the post-login carry snapshot captured during a fresh flow.
 */
interface IConfigTokenStrategy extends ITokenStrategy<GenericCreds> {
  getLatestLongTermToken(): string;
  getLatestCarrySnapshot(): Readonly<Record<string, JsonValue>>;
  /** Whether the most recent prime reused a cached warm seed (vs cold flow). */
  lastPrimeWasWarm(): boolean;
}

/** Args for runConfiguredFlow — respects 3-param ceiling. */
interface IRunFlowArgs {
  readonly config: IApiDirectCallConfig;
  readonly bus: ITokenBus;
  readonly creds: GenericCreds;
  readonly companyId: ITokenContext['companyId'];
  readonly initialCarry?: Readonly<Record<string, JsonValue>>;
  readonly startStepIndex?: number;
}

/** Mutable capture slot updated on every successful flow. */
interface ILongTermTokenSlot {
  latest: string;
  latestCarrySnapshot: Readonly<Record<string, JsonValue>>;
  /** True when the last prime reused a cached warm seed; false on cold flow. */
  usedWarmPath?: boolean;
}

/** Subset of IFlowResult consumed by captureFlowResult. */
interface IFlowCapture {
  readonly longTermToken: string;
  readonly carrySnapshot: Readonly<Record<string, JsonValue>>;
}

/** Args for makeWarmArgs — respects 3-param ceiling. */
interface IMakeWarmArgs {
  readonly config: IApiDirectCallConfig;
  readonly bus: ITokenBus;
  readonly creds: GenericCreds;
  readonly stored: string;
  readonly companyId: ITokenContext['companyId'];
}

/** Args bundle for primeInitialImpl / primeFreshImpl. */
interface IPrimeArgs {
  readonly config: IApiDirectCallConfig;
  readonly bus: ITokenBus;
  readonly ctx: ITokenContext;
  readonly creds: GenericCreds;
  readonly slot: ILongTermTokenSlot;
}

/** Args for createTokenStrategyFromConfig. */
interface ICreateTokenStrategyArgs {
  readonly config: IApiDirectCallConfig;
  readonly name?: string;
}

/** Strategy bindings — the 5 functions exposed by the strategy (without name). */
type IStrategyBindings = Omit<IConfigTokenStrategy, 'name'>;
export type {
  GenericCreds,
  IConfigTokenStrategy,
  ICreateTokenStrategyArgs,
  IFlowCapture,
  ILongTermTokenSlot,
  IMakeWarmArgs,
  IPrimeArgs,
  IRunFlowArgs,
  IStrategyBindings,
};
