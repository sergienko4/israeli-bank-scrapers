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
import type { ITokenStrategy } from '../../Api/ITokenStrategy.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';
import { isJwtFresh } from '../Jwt/GenericJwtClaims.js';
import { runSmsOtpFlow } from './SmsOtpFlow.js';

/** Generic creds shape — strategies read named fields via config. */
type GenericCreds = Readonly<Record<string, unknown>>;

/**
 * Extended ITokenStrategy exposing the most recent long-term token
 * + the post-login carry snapshot captured during a fresh flow.
 * The token getter returns '' until the first successful flow; the
 * snapshot getter returns an empty frozen object until then.
 */
interface IConfigTokenStrategy extends ITokenStrategy<GenericCreds> {
  getLatestLongTermToken(): string;
  getLatestCarrySnapshot(): Readonly<Record<string, JsonValue>>;
}

/** Default strategy display name. */
const STRATEGY_NAME_DEFAULT = 'ApiDirectCall';

/**
 * Read a string-valued creds field, returning '' when absent or wrong type.
 * @param creds - Caller credentials.
 * @param field - Field name.
 * @returns String value or ''.
 */
function readCredsString(creds: GenericCreds, field: string): string {
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
function formatAuthValue(config: IApiDirectCallConfig, token: string): string {
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
  latestCarrySnapshot: Readonly<Record<string, JsonValue>>;
}

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

/** Subset of IFlowResult consumed by captureFlowResult. */
interface IFlowCapture {
  readonly longTermToken: string;
  readonly carrySnapshot: Readonly<Record<string, JsonValue>>;
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
  captureFlowResult(slot, flowProc.value);
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

/** Diagnostic message — warmStart required for makeWarmArgs. */
const WARM_REQUIRED_MSG = 'makeWarmArgs requires config.warmStart to be set';

/**
 * Build the warm-path IRunFlowArgs given a stored seed value.
 * @param args - Config + bus + creds + stored seed + companyId.
 * @returns Warm-path run args.
 */
function makeWarmArgs(args: IMakeWarmArgs): IRunFlowArgs {
  const warm = args.config.warmStart;
  if (warm === undefined) throw new ScraperError(WARM_REQUIRED_MSG);
  const initialCarry: Record<string, JsonValue> = { [warm.carryField]: args.stored };
  const { config, bus, creds, companyId } = args;
  return { config, bus, creds, companyId, initialCarry, startStepIndex: warm.fromStepIndex };
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
async function primeInitialImpl(args: IPrimeArgs): Promise<Procedure<string>> {
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
async function primeFreshImpl(args: IPrimeArgs): Promise<Procedure<string>> {
  const { config, bus, ctx, creds, slot } = args;
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

/** Args for createTokenStrategyFromConfig — respects 3-param ceiling. */
interface ICreateTokenStrategyArgs {
  readonly config: IApiDirectCallConfig;
  readonly name?: string;
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

/** Binding factory output — the 5 functions exposed by the strategy. */
type IStrategyBindings = Omit<IConfigTokenStrategy, 'name'>;

/**
 * primeInitial factory — captures (config, slot) for the dispatch.
 * @param config - Bank config.
 * @param slot - Mutable capture slot.
 * @returns Strategy primeInitial binding.
 */
function makePrimeInitial(
  config: IApiDirectCallConfig,
  slot: ILongTermTokenSlot,
): IConfigTokenStrategy['primeInitial'] {
  return (bus, ctx, creds): Promise<Procedure<string>> =>
    primeInitialImpl({ config, bus, ctx, creds, slot });
}

/**
 * primeFresh factory — captures (config, slot) for the dispatch.
 * @param config - Bank config.
 * @param slot - Mutable capture slot.
 * @returns Strategy primeFresh binding.
 */
function makePrimeFresh(
  config: IApiDirectCallConfig,
  slot: ILongTermTokenSlot,
): IConfigTokenStrategy['primeFresh'] {
  return (bus, ctx, creds): Promise<Procedure<string>> =>
    primeFreshImpl({ config, bus, ctx, creds, slot });
}

/**
 * hasWarmState factory — wraps hasWarmStateImpl with captured config.
 * @param config - Bank config.
 * @returns Strategy hasWarmState binding.
 */
function makeHasWarmState(config: IApiDirectCallConfig): IConfigTokenStrategy['hasWarmState'] {
  return (creds): boolean => hasWarmStateImpl(config, creds);
}

/**
 * getLatestLongTermToken factory — closes over the slot.
 * @param slot - Mutable capture slot.
 * @returns Strategy getLatestLongTermToken binding.
 */
function makeGetLatestLongTermToken(
  slot: ILongTermTokenSlot,
): IConfigTokenStrategy['getLatestLongTermToken'] {
  return (): string => slot.latest;
}

/**
 * getLatestCarrySnapshot factory — closes over the slot.
 * @param slot - Mutable capture slot.
 * @returns Strategy getLatestCarrySnapshot binding.
 */
function makeGetLatestCarrySnapshot(
  slot: ILongTermTokenSlot,
): IConfigTokenStrategy['getLatestCarrySnapshot'] {
  return (): Readonly<Record<string, JsonValue>> => slot.latestCarrySnapshot;
}

/**
 * Build the 5 bindings exposed by IConfigTokenStrategy.
 * @param config - Bank config.
 * @param slot - Mutable capture slot.
 * @returns Strategy bindings (no name field).
 */
function buildStrategyBindings(
  config: IApiDirectCallConfig,
  slot: ILongTermTokenSlot,
): IStrategyBindings {
  return {
    primeInitial: makePrimeInitial(config, slot),
    primeFresh: makePrimeFresh(config, slot),
    hasWarmState: makeHasWarmState(config),
    getLatestLongTermToken: makeGetLatestLongTermToken(slot),
    getLatestCarrySnapshot: makeGetLatestCarrySnapshot(slot),
  };
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
  const { config } = args;
  const name = args.name ?? STRATEGY_NAME_DEFAULT;
  const slot: ILongTermTokenSlot = { latest: '', latestCarrySnapshot: Object.freeze({}) };
  const bindings = buildStrategyBindings(config, slot);
  return succeed({ name, ...bindings });
}

export type { GenericCreds, IConfigTokenStrategy, ICreateTokenStrategyArgs };
export { createTokenStrategyFromConfig };
