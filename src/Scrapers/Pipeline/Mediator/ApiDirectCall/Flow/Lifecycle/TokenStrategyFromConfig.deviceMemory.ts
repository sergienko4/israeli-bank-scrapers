/**
 * Device-memory durable auth — the bank remembers a device by the id it
 * issued, so a run that sends that id back skips the OTP step.
 *
 * <p>Enroll runs the configured login with no seed and publishes the issued
 * id once. Resume checks the stored state locally, then seeds the id into
 * carry before the same login; nothing new is published. The configured
 * flow keeps the seeded id (the step's `keepExisting` extract).
 */

import { getDebug } from '../../../../Logging/Debug.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { isOk, succeed } from '../../../../Types/Procedure.js';
import {
  decodeDeviceMemoryState,
  encodeDeviceMemoryState,
  isDeviceMemoryId,
} from '../../DeviceMemoryStateCodec.js';
import type { JsonValue } from '../../Envelope/JsonPointer.js';
import type { IPersistentAuthExpectation } from '../../PersistentAuthStateRules.js';
import { durableFail, invokeOnUpdate } from './TokenStrategyFromConfig.persistent.js';
import { omitFlowFailureText } from './TokenStrategyFromConfig.scrub.js';
import type { IDurablePrimeArgs, IRunFlowArgs } from './TokenStrategyFromConfig.types.js';

const LOG = getDebug(import.meta.url);

/** One device-memory prime: prime args, mode and the narrowed block. */
type DeviceMemoryRun = IDurablePrimeArgs<'device-memory'>;

/** Carry the login starts from: empty on enroll, the stored id on resume. */
type DeviceSeed = Readonly<Record<string, JsonValue>>;

/**
 * Provider and account the state is bound to. The account is lower-cased:
 * the bank's identity for it is case-insensitive.
 * @param run - Device-memory prime.
 * @returns Expected provider and account.
 */
function ownerOf(run: DeviceMemoryRun): IPersistentAuthExpectation {
  return { provider: run.block.provider, account: run.mode.account.toLowerCase() };
}

/**
 * Decode the stored state, before any request, into the starting carry.
 * @param run - Device-memory prime.
 * @returns Empty seed on enroll, the stored id on resume, or a category failure.
 */
function seedOf(run: DeviceMemoryRun): Procedure<DeviceSeed> {
  const { mode } = run;
  if (mode.kind === 'enroll') return succeed({});
  const owner = ownerOf(run);
  const stored = decodeDeviceMemoryState(mode.encodedState, owner);
  if (!isOk(stored)) return stored;
  return succeed({ [run.block.deviceIdField]: stored.value.deviceId });
}

/**
 * Build the configured login's args with the device seed.
 * @param run - Device-memory prime.
 * @param initialCarry - Starting carry.
 * @returns Flow args.
 */
function flowArgsOf(run: DeviceMemoryRun, initialCarry: DeviceSeed): IRunFlowArgs {
  const { config, bus, creds, ctx } = run.prime;
  return { config, bus, creds, companyId: ctx.companyId, initialCarry };
}

/**
 * Read the device id the finished login holds in carry.
 * @param run - Device-memory prime.
 * @returns The id, or a `device-id` failure when missing or invalid.
 */
function readDeviceId(run: DeviceMemoryRun): Procedure<string> {
  const deviceId = run.prime.slot.latestCarrySnapshot[run.block.deviceIdField];
  if (!isDeviceMemoryId(deviceId)) return durableFail('device-id');
  return succeed(deviceId);
}

/**
 * Encode the state for a freshly issued id; the codec round-trips it.
 * @param run - Device-memory prime.
 * @param deviceId - The validated device id.
 * @returns Opaque state, or a category failure.
 */
function encodeEnrolled(run: DeviceMemoryRun, deviceId: string): Procedure<string> {
  const owner = ownerOf(run);
  const state = { version: 1, kind: 'device-memory', ...owner, deviceId } as const;
  return encodeDeviceMemoryState(state, owner);
}

/**
 * Publish the issued id once, when enrolling; a resume publishes nothing.
 * @param run - Device-memory prime.
 * @param deviceId - The validated device id.
 * @returns Whether a state was published, or a failure.
 */
async function publishEnrolled(
  run: DeviceMemoryRun,
  deviceId: string,
): Promise<Procedure<boolean>> {
  if (run.mode.kind === 'resume') return succeed(false);
  const encoded = encodeEnrolled(run, deviceId);
  if (!isOk(encoded)) return encoded;
  return invokeOnUpdate(run.mode, encoded.value);
}

/**
 * Log a settled prime: the mode and whether it published — never a value.
 * @param run - Device-memory prime.
 * @param published - Publish outcome.
 * @returns The outcome, unchanged.
 */
function logSettled(run: DeviceMemoryRun, published: Procedure<boolean>): Procedure<boolean> {
  if (!isOk(published)) return published;
  LOG.debug({ mode: run.mode.kind, published: published.value }, 'device-memory auth settled');
  return published;
}

/**
 * Check the issued id and publish it on enroll, before the scrape starts.
 * @param run - Device-memory prime.
 * @returns Whether a state was published, or the first failure.
 */
async function settleDeviceMemory(run: DeviceMemoryRun): Promise<Procedure<boolean>> {
  const deviceId = readDeviceId(run);
  if (!isOk(deviceId)) return deviceId;
  const published = await publishEnrolled(run, deviceId.value);
  return logSettled(run, published);
}

/**
 * primeInitial for a device-memory strategy.
 * @param run - Prime args, durable mode, the device-memory block and runner.
 * @returns Formatted Authorization header value.
 */
async function primeDeviceMemory(run: DeviceMemoryRun): Promise<Procedure<string>> {
  const seed = seedOf(run);
  if (!isOk(seed)) return seed;
  const flowArgs = flowArgsOf(run, seed.value);
  const headerValue = await run.runFlow(flowArgs, run.prime.slot);
  if (!isOk(headerValue)) return omitFlowFailureText(headerValue);
  const settled = await settleDeviceMemory(run);
  return isOk(settled) ? headerValue : settled;
}

export default primeDeviceMemory;
export { primeDeviceMemory };
