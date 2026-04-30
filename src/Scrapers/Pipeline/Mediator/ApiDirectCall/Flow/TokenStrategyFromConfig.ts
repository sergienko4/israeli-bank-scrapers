/**
 * TokenStrategyFromConfig — generic ITokenStrategy<TCreds> built
 * from an IApiDirectCallConfig literal. Implements primeInitial
 * (optional warm-start short-circuit), primeFresh (always runs
 * SmsOtpFlow cold) and hasWarmState.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import ScraperError from '../../../../Base/ScraperError.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiMediator } from '../../Api/ApiMediator.js';
import type { AuthorizationHeaderValue, TokenResolverName } from '../../Api/ITokenResolver.js';
import type { ITokenStrategy, WarmStateFlag } from '../../Api/ITokenStrategy.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';
import { isJwtFresh } from '../Jwt/GenericJwtClaims.js';
import { runSmsOtpFlow } from './SmsOtpFlow.js';

/** Generic creds shape — strategies read named fields via config. */
type GenericCreds = Readonly<Record<string, unknown>>;

/** Value of a string-typed creds field (empty string when absent). */
type CredsFieldValue = string;

/** Latest long-term token captured from the most recent successful flow. */
type LatestLongTermToken = string;

/**
 * Extended ITokenStrategy exposing the most recent long-term token
 * captured during a fresh flow. Returns '' until the first successful
 * flow completes.
 */
interface IConfigTokenStrategy extends ITokenStrategy<GenericCreds> {
  getLatestLongTermToken(): string;
}

/** Default strategy display name. */
const STRATEGY_NAME_DEFAULT: TokenResolverName = 'ApiDirectCall';

/**
 * Read a string-valued creds field, returning '' when absent or wrong type.
 * @param creds - Caller credentials.
 * @param field - Field name.
 * @returns String value or ''.
 */
function readCredsString(creds: GenericCreds, field: string): CredsFieldValue {
  const value = creds[field];
  if (typeof value !== 'string') return '';
  return value;
}

/**
 * Format the Authorization header value per config.authScheme.
 * @param config - API-direct-call config.
 * @param token - Raw token string (no prefix).
 * @returns Authorization header value.
 */
function formatAuthValue(config: IApiDirectCallConfig, token: string): AuthorizationHeaderValue {
  if (config.authScheme === 'bearer') return `Bearer ${token}`;
  return token;
}

/**
 * Decide whether to take the warm-start path. Returns the stored
 * creds value to pre-seed into carry, or undefined when cold path
 * should run.
 * @param config - API-direct-call config.
 * @param creds - Caller credentials.
 * @returns Stored value string or undefined.
 */
function pickWarmSeed(config: IApiDirectCallConfig, creds: GenericCreds): string | false {
  const warm = config.warmStart;
  if (warm === undefined) return false;
  const stored = readCredsString(creds, warm.credsField);
  if (stored.length === 0) return false;
  if (config.jwtClaims !== undefined && !isJwtFresh(stored, config.jwtClaims)) {
    return false;
  }
  return stored;
}

/** Args for runConfiguredFlow — respects 3-param ceiling. */
interface IRunFlowArgs {
  readonly config: IApiDirectCallConfig;
  readonly bus: IApiMediator;
  readonly creds: GenericCreds;
  readonly companyId: IPipelineContext['companyId'];
  readonly initialCarry?: Readonly<Record<string, JsonValue>>;
  readonly startStepIndex?: number;
}

/** Mutable capture slot updated on every successful flow. */
interface ILongTermTokenSlot {
  latest: string;
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
): Promise<Procedure<AuthorizationHeaderValue>> {
  const flowProc = await runSmsOtpFlow({
    config: args.config,
    bus: args.bus,
    creds: args.creds,
    companyId: args.companyId,
    initialCarry: args.initialCarry,
    startStepIndex: args.startStepIndex,
  });
  if (!isOk(flowProc)) return flowProc;
  if (flowProc.value.longTermToken.length > 0) {
    slot.latest = flowProc.value.longTermToken;
  }
  const authValue = formatAuthValue(args.config, flowProc.value.bearer);
  return succeed(authValue);
}

/** Args for makeWarmArgs — respects 3-param ceiling. */
interface IMakeWarmArgs {
  readonly config: IApiDirectCallConfig;
  readonly bus: IApiMediator;
  readonly creds: GenericCreds;
  readonly stored: string;
  readonly companyId: IPipelineContext['companyId'];
}

/**
 * Build the warm-path IRunFlowArgs given a stored seed value.
 * @param args - Config + bus + creds + stored seed + companyId.
 * @returns Warm-path run args.
 */
function makeWarmArgs(args: IMakeWarmArgs): IRunFlowArgs {
  const warm = args.config.warmStart;
  if (warm === undefined) {
    throw new ScraperError('makeWarmArgs requires config.warmStart to be set');
  }
  const initialCarry: Record<string, JsonValue> = { [warm.carryField]: args.stored };
  return {
    config: args.config,
    bus: args.bus,
    creds: args.creds,
    companyId: args.companyId,
    initialCarry,
    startStepIndex: warm.fromStepIndex,
  };
}

/** Args bundle for primeInitialImpl / primeFreshImpl — respects 3-param ceiling. */
interface IPrimeArgs {
  readonly config: IApiDirectCallConfig;
  readonly bus: IApiMediator;
  readonly ctx: IPipelineContext;
  readonly creds: GenericCreds;
  readonly slot: ILongTermTokenSlot;
}

/**
 * primeInitial — warm-start short-circuit (when creds[warmStart.credsField]
 * is populated AND JWT-fresh when jwtClaims configured); else cold flow.
 * @param args - Config + bus + ctx + creds + capture slot.
 * @returns Header-value procedure.
 */
async function primeInitialImpl(args: IPrimeArgs): Promise<Procedure<AuthorizationHeaderValue>> {
  const { config, bus, ctx, creds, slot } = args;
  const stored = pickWarmSeed(config, creds);
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
async function primeFreshImpl(args: IPrimeArgs): Promise<Procedure<AuthorizationHeaderValue>> {
  const { config, bus, ctx, creds, slot } = args;
  return runConfiguredFlow({ config, bus, creds, companyId: ctx.companyId }, slot);
}

/**
 * hasWarmState — non-empty creds[warmStart.credsField].
 * @param config - Config literal.
 * @param creds - Caller credentials.
 * @returns Warm-state flag.
 */
function hasWarmStateImpl(config: IApiDirectCallConfig, creds: GenericCreds): WarmStateFlag {
  if (config.warmStart === undefined) return false;
  return readCredsString(creds, config.warmStart.credsField).length > 0;
}

/** Args for createTokenStrategyFromConfig — respects 3-param ceiling. */
interface ICreateTokenStrategyArgs {
  readonly config: IApiDirectCallConfig;
  readonly name?: TokenResolverName;
}

/**
 * Validate the config's flow-kind — only 'sms-otp' is implemented.
 * @param config - Config literal.
 * @returns Procedure gate.
 */
function gateFlowKind(config: IApiDirectCallConfig): Procedure<true> {
  if (config.flow === 'sms-otp') return succeed(true);
  return fail(ScraperErrorTypes.Generic, `unsupported flow-kind: ${config.flow}`);
}

/**
 * Factory — build the config-driven token strategy.
 * @param args - Factory args (config + optional name).
 * @returns Procedure with the strategy instance, or unsupported-flow fail.
 */
function createTokenStrategyFromConfig(
  args: ICreateTokenStrategyArgs,
): Procedure<IConfigTokenStrategy> {
  const gate = gateFlowKind(args.config);
  if (!isOk(gate)) return gate;
  const config = args.config;
  const name = args.name ?? STRATEGY_NAME_DEFAULT;
  const slot: ILongTermTokenSlot = { latest: '' };
  /**
   * primeInitial binding — routes to primeInitialImpl with captured deps.
   * @param bus - ApiMediator.
   * @param ctx - Pipeline context.
   * @param creds - Caller credentials.
   * @returns Header-value procedure.
   */
  const primeInitial = (
    bus: IApiMediator,
    ctx: IPipelineContext,
    creds: GenericCreds,
  ): Promise<Procedure<AuthorizationHeaderValue>> => {
    return primeInitialImpl({ config, bus, ctx, creds, slot });
  };
  /**
   * primeFresh binding — routes to primeFreshImpl with captured deps.
   * @param bus - ApiMediator.
   * @param ctx - Pipeline context.
   * @param creds - Caller credentials.
   * @returns Header-value procedure.
   */
  const primeFresh = (
    bus: IApiMediator,
    ctx: IPipelineContext,
    creds: GenericCreds,
  ): Promise<Procedure<AuthorizationHeaderValue>> => {
    return primeFreshImpl({ config, bus, ctx, creds, slot });
  };
  /**
   * hasWarmState binding.
   * @param creds - Caller credentials.
   * @returns Warm-state flag.
   */
  const hasWarmState = (creds: GenericCreds): WarmStateFlag => hasWarmStateImpl(config, creds);
  /**
   * getLatestLongTermToken binding.
   * @returns Latest captured long-term token string.
   */
  const getLatestLongTermToken = (): LatestLongTermToken => slot.latest;
  const strategy: IConfigTokenStrategy = {
    name,
    primeInitial,
    primeFresh,
    hasWarmState,
    getLatestLongTermToken,
  };
  return succeed(strategy);
}

export type { GenericCreds, IConfigTokenStrategy, ICreateTokenStrategyArgs };
export { createTokenStrategyFromConfig };
