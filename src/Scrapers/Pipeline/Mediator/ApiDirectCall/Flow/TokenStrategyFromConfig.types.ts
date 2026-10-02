/**
 * Type aliases + interfaces for the TokenStrategyFromConfig cluster.
 */

import type { PersistentAuthStateCallback } from '../../../Types/Domain/PersistentAuthInput.js';
import type { ITokenBus } from '../../../Types/Domain/TokenBus.js';
import type { ITokenContext } from '../../../Types/Domain/TokenContext.js';
import type { ITokenStrategy } from '../../Api/ITokenStrategy.js';
import type { IApiDirectCallConfig, IPersistentAuthConfig } from '../ConfigContracts/index.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';

/** Generic creds shape — strategies read named fields via config. */
type GenericCreds = Readonly<Record<string, unknown>>;

/** No durable options, or a bank whose config has no persistent-auth block. */
interface ILegacyAuthMode {
  readonly kind: 'legacy';
}

/** Validated inputs every durable mode carries — never the raw options. */
interface IDurableAuthModeBase {
  /** The bank's persistent-auth block, already narrowed to present. */
  readonly block: IPersistentAuthConfig;
  /** Caller hook that stores replacement state before a bearer is used. */
  readonly onUpdate: PersistentAuthStateCallback;
  /** Normalised account the durable state is bound to. */
  readonly account: string;
}

/** Callback without state: enroll through the existing flow, then publish. */
interface IDurableEnrollMode extends IDurableAuthModeBase {
  readonly kind: 'enroll';
}

/** State with callback: replay the stored token, or renew it on the bound device. */
interface IDurableResumeMode extends IDurableAuthModeBase {
  readonly kind: 'resume';
  /** Opaque state as supplied; decoded and validated before any request. */
  readonly encodedState: string;
}

/** A mode that owns device-bound state — everything except legacy. */
type DurableAuthMode = IDurableEnrollMode | IDurableResumeMode;

/** Durable device-auth mode, resolved once before any auth request. */
type PersistentAuthMode = ILegacyAuthMode | DurableAuthMode;

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
  /**
   * Durable mode the strategy was built for; absent means legacy. Held here
   * rather than in creds or carry because it carries the caller's state and
   * storage callback, which must never reach templates, snapshots or logs.
   */
  readonly persistentAuth?: DurableAuthMode;
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
  /** Resolved durable mode; omitted or legacy keeps the existing behaviour. */
  readonly persistentAuth?: PersistentAuthMode;
}

/** Strategy bindings — the 5 functions exposed by the strategy (without name). */
type IStrategyBindings = Omit<IConfigTokenStrategy, 'name'>;
export type {
  DurableAuthMode,
  GenericCreds,
  IConfigTokenStrategy,
  ICreateTokenStrategyArgs,
  IFlowCapture,
  ILongTermTokenSlot,
  IMakeWarmArgs,
  IPrimeArgs,
  IRunFlowArgs,
  IStrategyBindings,
  PersistentAuthMode,
};
