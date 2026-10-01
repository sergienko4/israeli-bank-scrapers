/**
 * Durable branch of the config token strategy.
 *
 * <p>Enrollment walks the bank's existing SMS flow once and publishes the
 * completed device state. Resume replays a still-fresh token locally, or renews
 * an expired one through the bank's resume steps on the persisted device. Each
 * path publishes at most once, before its bearer is returned, and none writes
 * the legacy long-term-token slot — so the legacy token outputs stay empty.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { getDebug } from '../../../Logging/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IPersistentAuthConfig } from '../ConfigContracts/index.js';
import { exportPkcs8Base64 } from '../Crypto/CryptoKeyFactory.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import { isJwtFresh } from '../Jwt/GenericJwtClaims.js';
import {
  decodePersistentAuthState,
  encodePersistentAuthState,
  type IPersistentAuthExpectation,
  type IPersistentAuthStateV1,
  type IRehydratedPersistentAuth,
} from '../PersistentAuthStateCodec.js';
import { type IFlowResult, type IRunSmsOtpArgs, runSmsOtpFlow } from './SmsOtpFlow.js';
import { mayStartFlow } from './TokenStrategyFromConfig.budget.js';
import { scrubPersistedValues } from './TokenStrategyFromConfig.scrub.js';
import { formatAuthValue } from './TokenStrategyFromConfig.shared.js';
import type { DurableAuthMode, IPrimeArgs, IRunFlowArgs } from './TokenStrategyFromConfig.types.js';

const LOG = getDebug(import.meta.url);

/** Carry slot every flow leaves its bearer in — see SmsOtpFlow's `carry.token`. */
const BEARER_CARRY_FIELD = 'token';

/** Freshness claim read when the bank config declares none. */
const DEFAULT_FRESHNESS_FIELD = 'exp';

/** One durable prime: the strategy's prime args plus the narrowed mode. */
interface IDurableRun {
  readonly prime: IPrimeArgs;
  readonly mode: DurableAuthMode;
}

/** Device identity enrollment captures from the completed flow's carry. */
type DeviceIdentity = Pick<IPersistentAuthStateV1, 'clientInstanceId' | 'deviceId'>;

/** A completed flow's outcome: the state to publish and the carry to expose. */
interface ISettledFlow {
  readonly state: IPersistentAuthStateV1;
  readonly carrySnapshot: Readonly<Record<string, JsonValue>>;
}

/**
 * Category-only failure — never carries a token, key, state or server text.
 * @param category - Stable failure category.
 * @returns Generic failure.
 */
function durableFail(category: string): Procedure<never> {
  return fail(ScraperErrorTypes.Generic, `persistent auth failed: ${category}`);
}

/**
 * Identity every decoded or encoded state must match.
 * @param mode - Durable mode.
 * @returns Provider tag and normalized account.
 */
function expectationOf(mode: DurableAuthMode): IPersistentAuthExpectation {
  return { provider: mode.block.provider, account: mode.account };
}

/**
 * Hand encoded state to the caller once. A rejection is reported by category
 * only, because the caller's error text may echo the state it was given.
 * @param mode - Durable mode holding the callback.
 * @param encoded - Opaque state to store.
 * @returns True once the caller resolved.
 */
async function invokeOnUpdate(mode: DurableAuthMode, encoded: string): Promise<Procedure<true>> {
  try {
    await mode.onUpdate(encoded);
    return succeed(true);
  } catch {
    return durableFail('callback');
  }
}

/**
 * Encode — which round-trips the strict decoder — then publish once.
 * @param mode - Durable mode.
 * @param state - Completed state.
 * @returns True once stored by the caller.
 */
async function publishState(
  mode: DurableAuthMode,
  state: IPersistentAuthStateV1,
): Promise<Procedure<true>> {
  const expected = expectationOf(mode);
  const encoded = encodePersistentAuthState(state, expected);
  if (!isOk(encoded)) return encoded;
  return invokeOnUpdate(mode, encoded.value);
}

/**
 * Publish the state, then — only once stored — expose the bearer.
 * @param run - Durable run.
 * @param settled - Completed state plus the carry to install as session context.
 * @returns Formatted Authorization header value.
 */
async function settleDurable(run: IDurableRun, settled: ISettledFlow): Promise<Procedure<string>> {
  const published = await publishState(run.mode, settled.state);
  if (!isOk(published)) return published;
  run.prime.slot.latestCarrySnapshot = settled.carrySnapshot;
  const headerValue = formatAuthValue(run.prime.config, settled.state.accessToken);
  return succeed(headerValue);
}

/**
 * Flow inputs shared by enrollment and resume.
 * @param prime - Strategy prime args.
 * @returns Runner args with the caller's credentials.
 */
function baseFlowArgs(prime: IPrimeArgs): IRunFlowArgs {
  const { config, bus, creds, ctx } = prime;
  return { config, bus, creds, companyId: ctx.companyId };
}

/**
 * Read the client instance and device identifiers enrollment bound.
 * @param block - Bank persistent-auth block naming the carry slots.
 * @param carry - Completed enrollment carry.
 * @returns Both identifiers, or a category-only failure.
 */
function readDeviceIdentity(
  block: IPersistentAuthConfig,
  carry: Readonly<Record<string, JsonValue>>,
): Procedure<DeviceIdentity> {
  const clientInstanceId = carry[block.clientInstanceIdField];
  const deviceId = carry[block.deviceIdField];
  if (typeof clientInstanceId !== 'string') return durableFail('enrollment-identity');
  if (typeof deviceId !== 'string') return durableFail('enrollment-identity');
  return succeed({ clientInstanceId, deviceId });
}

/**
 * Export the EC key enrollment generated, so resume can sign with it.
 * @param flow - Completed enrollment flow.
 * @returns PKCS#8 base64, or a category-only failure.
 */
function exportEnrolledKey(flow: IFlowResult): Procedure<string> {
  const ec = flow.keypairs.ec;
  if (ec === undefined) return durableFail('enrollment-key');
  const pkcs8 = exportPkcs8Base64(ec);
  return succeed(pkcs8);
}

/**
 * Assemble the state a completed enrollment publishes.
 * @param run - Durable run.
 * @param flow - Completed enrollment flow.
 * @returns State, or a category-only failure.
 */
function enrolledState(run: IDurableRun, flow: IFlowResult): Procedure<IPersistentAuthStateV1> {
  const key = exportEnrolledKey(flow);
  if (!isOk(key)) return key;
  const identity = readDeviceIdentity(run.mode.block, flow.carrySnapshot);
  if (!isOk(identity)) return identity;
  const owner = expectationOf(run.mode);
  const bound = { ...owner, ...identity.value, ecPrivateKeyPkcs8Base64: key.value };
  return succeed({ version: 1, ...bound, accessToken: flow.bearer });
}

/**
 * Enroll: run the existing SMS flow once, then publish the device state.
 * @param run - Durable run in enroll mode.
 * @returns Formatted Authorization header value.
 */
async function enrollDurable(run: IDurableRun): Promise<Procedure<string>> {
  const flowArgs = baseFlowArgs(run.prime);
  const canStart = mayStartFlow(flowArgs, run.prime.slot);
  if (!canStart) return durableFail('enrollment-budget');
  const flow = await runSmsOtpFlow(flowArgs);
  if (!isOk(flow)) return flow;
  const state = enrolledState(run, flow.value);
  if (!isOk(state)) return state;
  return settleDurable(run, { state: state.value, carrySnapshot: flow.value.carrySnapshot });
}

/**
 * Whether the stored token outlives the durable replay margin.
 * @param run - Durable run.
 * @param accessToken - Stored JWT.
 * @returns True when it may be replayed without a request.
 */
function isReplayable(run: IDurableRun, accessToken: string): boolean {
  const freshnessField = run.prime.config.jwtClaims?.freshnessField ?? DEFAULT_FRESHNESS_FIELD;
  const skewSeconds = run.mode.block.freshnessMarginSeconds;
  return isJwtFresh(accessToken, { freshnessField, skewSeconds });
}

/**
 * Replay a fresh stored token: no request, no callback.
 * @param run - Durable run.
 * @param accessToken - Stored JWT.
 * @returns Formatted Authorization header value.
 */
function replayFresh(run: IDurableRun, accessToken: string): Procedure<string> {
  run.prime.slot.latestCarrySnapshot = Object.freeze({ [BEARER_CARRY_FIELD]: accessToken });
  const headerValue = formatAuthValue(run.prime.config, accessToken);
  return succeed(headerValue);
}

/**
 * Resume-flow inputs: the persisted key signs, the persisted device id seeds
 * the carry, and the persisted client instance id reaches the bank as creds.
 * @param run - Durable run.
 * @param rehydrated - Decoded state and its EC keypair.
 * @returns Runner args walking only the bank's resume steps.
 */
function resumeFlowArgs(run: IDurableRun, rehydrated: IRehydratedPersistentAuth): IRunSmsOtpArgs {
  const { block } = run.mode;
  const { state, ecKeypair } = rehydrated;
  const base = baseFlowArgs(run.prime);
  const creds = { ...base.creds, [block.clientInstanceIdField]: state.clientInstanceId };
  const initialCarry = { [block.deviceIdField]: state.deviceId };
  return { ...base, creds, initialCarry, keypairs: { ec: ecKeypair }, steps: block.resumeSteps };
}

/**
 * Renew an expired token on the bound device, then publish the replacement.
 * @param run - Durable run.
 * @param rehydrated - Decoded state and its EC keypair.
 * @returns Formatted Authorization header value.
 */
async function renewExpired(
  run: IDurableRun,
  rehydrated: IRehydratedPersistentAuth,
): Promise<Procedure<string>> {
  const flowArgs = resumeFlowArgs(run, rehydrated);
  const flow = await runSmsOtpFlow(flowArgs);
  if (!isOk(flow)) return scrubPersistedValues(flow, rehydrated.state);
  const state = { ...rehydrated.state, accessToken: flow.value.bearer };
  return settleDurable(run, { state, carrySnapshot: flow.value.carrySnapshot });
}

/**
 * Resume: validate the state before any request, then replay or renew.
 * @param run - Durable run.
 * @param encodedState - Opaque state as supplied.
 * @returns Formatted Authorization header value.
 */
async function resumeDurable(run: IDurableRun, encodedState: string): Promise<Procedure<string>> {
  const expected = expectationOf(run.mode);
  const decoded = decodePersistentAuthState(encodedState, expected);
  if (!isOk(decoded)) return decoded;
  const { accessToken } = decoded.value.state;
  if (isReplayable(run, accessToken)) return replayFresh(run, accessToken);
  return renewExpired(run, decoded.value);
}

/**
 * primeInitial for a durable strategy.
 * @param prime - Strategy prime args.
 * @param mode - Durable mode the strategy was built for.
 * @returns Formatted Authorization header value.
 */
async function primeDurable(prime: IPrimeArgs, mode: DurableAuthMode): Promise<Procedure<string>> {
  const run: IDurableRun = { prime, mode };
  if (mode.kind === 'resume') return resumeDurable(run, mode.encodedState);
  return enrollDurable(run);
}

/**
 * primeFresh for a durable strategy: refuse locally, without a request. A
 * rejected durable session is never renewed or re-enrolled mid-run, so a 401
 * cannot escalate into another password flow or an SMS. Logged because the
 * mediator discards this failure and surfaces the original rejection.
 * @param prime - Strategy prime args.
 * @returns Category-only failure.
 */
function refuseDurableRefresh(prime: IPrimeArgs): Procedure<string> {
  const meta = { companyId: prime.ctx.companyId };
  LOG.warn(meta, 'Persistent auth refuses an in-run renewal — start a new scrape');
  return durableFail('in-run-renewal');
}

export { primeDurable, refuseDurableRefresh };
