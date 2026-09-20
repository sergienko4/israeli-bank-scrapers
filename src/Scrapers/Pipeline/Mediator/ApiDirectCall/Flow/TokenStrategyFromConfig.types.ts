/**
 * Type aliases + interfaces for the TokenStrategyFromConfig cluster.
 */

import type { ITokenBus } from '../../../Types/Domain/TokenBus.js';
import type { ITokenContext } from '../../../Types/Domain/TokenContext.js';
import type { ITokenStrategy } from '../../Api/ITokenStrategy.js';
import type { IApiDirectCallConfig } from '../ConfigContracts/index.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';

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
  /**
   * Whether the stored seed was refused by the local freshness gate, before
   * any request went out. Distinguishes "we never asked the bank" from "the
   * bank said no", which read identically from the warm flag alone.
   */
  warmSeedRejectedLocally(): boolean;
  /**
   * How the warm attempt failed, as a ScraperErrorTypes tag, or '' when none
   * was attempted or it succeeded. The cold retry fires on *any* primeInitial
   * failure, so without this the fallback warning can only guess.
   *
   * <p>The tag, never the message: banks echo credentials into `errorMessage`
   * (see PiiRedactor/ErrorLog, CodeQL js/clear-text-logging #28).
   */
  warmAttemptFailureType(): string;
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
  /**
   * True when `pickWarmSeed` refused the stored seed locally, so it was never
   * sent. Only `primeInitial` writes it — a later cold retry must not erase
   * the reason the warm path was skipped.
   */
  warmSeedRejectedLocally?: boolean;
  /** ScraperErrorTypes tag from the warm attempt, when one was made and failed. */
  warmAttemptFailureType?: string;
  /**
   * Cold logins this run has already started. A cold flow replays the bank's
   * login from the beginning, walking the step that sends the SMS, so this is
   * the count of messages the run has cost. Capped at one per run: the
   * mediator refreshes once per rejected request, and without a counter a
   * session the bank keeps refusing spends one message per call.
   */
  coldFlowsStarted?: number;
  /**
   * Authorization header the run's one cold flow produced, absent until that
   * flow succeeds.
   *
   * <p>Kept so a budget refusal can hand back the session the run already
   * paid an SMS for instead of discarding it. Without this a warm resume that
   * is rejected *after* its own 401 already triggered the run's cold login
   * would fail the whole scrape, even though a valid bearer had just been
   * minted and installed.
   *
   * <p>Written on cold successes only, deliberately. A warm bearer reaching
   * this field would be surrendered on refusal even though the 401 that
   * forced the cold login is proof the bank had already rejected it — the run
   * would retry a known-dead token instead of surfacing the real diagnosis.
   * Distinct from `latest`, which holds the long-term token (OneZero's
   * `idToken`) rather than the bearer.
   */
  latestHeaderValue?: string;
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
