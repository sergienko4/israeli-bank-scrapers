/**
 * Redaction invariant across every credential, carry slot, config secret and
 * header the pipeline can log. The suite reads the production path list and
 * the registered bank configs, so a new field cannot silently escape the
 * logger's default-deny rule.
 */

import { PassThrough } from 'node:stream';

import pino from 'pino';

import type { ScraperCredentials } from '../../../../Scrapers/Base/Interface.js';
import BANK_PIPELINE_TABLE from '../../../../Scrapers/Pipeline/Banks/BankPipelineTable.js';
import { buildSilentOptions } from '../../../../Scrapers/Pipeline/Logging/RootLoggerOptions.js';
import type {
  IApiDirectCallConfig,
  ICarryGenerator,
} from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { createCensorFn } from '../../../../Scrapers/Pipeline/Types/PiiRedactor.js';

/** Keys present on at least one arm of a union. */
type KeysOfUnion<T> = T extends unknown ? keyof T : never;

/** Every key a caller may put in a credential bag. */
type CredentialKey = KeysOfUnion<ScraperCredentials>;

/** Credential keys the list below does not cover; `never` when complete. */
type MissingCredentialKey = Exclude<CredentialKey, (typeof CREDENTIAL_KEYS)[number]>;

/** True only when the list covers every credential key. */
type CredentialsCovered = MissingCredentialKey extends never ? true : false;

/** One login step of a registered bank config. */
type StepConfig = IApiDirectCallConfig['steps'][number];

/** Every credential key, including the legacy alias normalization accepts. */
const CREDENTIAL_KEYS = [
  'card6Digits',
  'deviceSignature',
  'email',
  'id',
  'nationalID',
  'num',
  'otpCodeRetriever',
  'otpLongTermToken',
  'password',
  'phoneNumber',
  'userCode',
  'username',
] as const satisfies readonly CredentialKey[];

/** Compile-time guard: a missing credential key makes the value unassignable. */
const hasAllCredentialKeys: CredentialsCovered = true;

/** Header names a bank request or answer can carry. */
const HEADER_NAMES = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'content-type',
] as const;

/** Names collected from the registered bank configs. */
interface IConfigFacts {
  readonly carrySlots: readonly string[];
  readonly secretKeys: readonly string[];
}

/**
 * A synthetic value that cannot occur in a real log line.
 * @param name - Field name.
 * @returns The marker.
 */
function markerOf(name: string): string {
  return `syn-redaction-${name}-4f2a`;
}

/**
 * Map every name to a unique marker.
 * @param names - Field names.
 * @returns Marker record.
 */
function markersFor(names: readonly string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const name of names) record[name] = markerOf(name);
  return record;
}

/**
 * Collect a warm start's carry slots.
 * @param warm - Warm-start config.
 * @param slots - Target set.
 * @returns The target set.
 */
function collectWarmSlots(
  warm: IApiDirectCallConfig['warmStart'],
  slots: Set<string>,
): Set<string> {
  if (warm === undefined || warm.kind === 'cookie-jar') return slots;
  if (warm.kind === 'carry-bundle') {
    for (const slot of warm.slots) slots.add(slot);
    return slots;
  }
  slots.add(warm.carryField);
  return slots;
}

/**
 * Collect one generator's carry slots.
 * @param generator - Step carry generator.
 * @param slots - Target set.
 * @returns The target set.
 */
function collectGeneratorSlots(generator: ICarryGenerator, slots: Set<string>): Set<string> {
  if (generator.kind === 'rsa-key') {
    if (generator.keyInto !== undefined) slots.add(generator.keyInto);
    if (generator.spkiSha256HexInto !== undefined) slots.add(generator.spkiSha256HexInto);
    return slots;
  }
  if (generator.kind === 'pkcs10-csr') {
    slots.add(generator.into);
    return slots;
  }
  slots.add(generator.publicInto);
  slots.add(generator.privateInto);
  return slots;
}

/**
 * Collect the structured, form and location capture slots of one step.
 * @param step - Login step config.
 * @param slots - Target set.
 * @returns The target set.
 */
function collectCaptureSlots(step: StepConfig, slots: Set<string>): Set<string> {
  if (step.formCapture !== undefined) slots.add(step.formCapture.into);
  if (step.locationCapture !== undefined) slots.add(step.locationCapture.into);
  const structured = step.structuredCapture;
  if (structured === undefined) return slots;
  if (structured.kind !== 'jwt-claims') {
    slots.add(structured.into);
    return slots;
  }
  for (const slot of Object.keys(structured.captures)) slots.add(slot);
  return slots;
}

/**
 * Collect the keys of every supplied record.
 * @param records - Records that may be absent.
 * @param slots - Target set.
 * @returns The target set.
 */
function collectRecordSlots(records: readonly unknown[], slots: Set<string>): Set<string> {
  for (const record of records) {
    if (!isRecord(record)) continue;
    for (const slot of Object.keys(record)) slots.add(slot);
  }
  return slots;
}

/**
 * Whether a value is an object whose keys can be read.
 * @param value - Candidate value.
 * @returns True for a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Collect the extract, text-capture and derivation slots of one step.
 * @param step - Login step config.
 * @param slots - Target set.
 * @returns The target set.
 */
function collectExtractSlots(step: StepConfig, slots: Set<string>): Set<string> {
  collectRecordSlots(
    [
      step.extractsToCarry,
      step.optionalExtractsToCarry,
      step.headerExtractsToCarry,
      step.textCaptures,
    ],
    slots,
  );
  for (const derived of step.deriveCarry ?? []) slots.add(derived.into);
  for (const generator of step.generate ?? []) collectGeneratorSlots(generator, slots);
  return collectCaptureSlots(step, slots);
}

/**
 * Collect the device-identity and durable-state carry slots of one config.
 * @param config - Bank api-direct config.
 * @param slots - Target set.
 * @returns The target set.
 */
function collectDurableSlots(config: IApiDirectCallConfig, slots: Set<string>): Set<string> {
  const identity = config.deviceIdentity;
  if (identity !== undefined) slots.add(identity.seedSlot);
  const durable = config.persistentAuth;
  if (durable === undefined) return slots;
  slots.add(durable.deviceIdField);
  if (durable.kind === 'bound-device') slots.add(durable.clientInstanceIdField);
  return slots;
}

/**
 * Collect every carry slot one config declares.
 * @param config - Bank api-direct config.
 * @param slots - Target set.
 * @returns The target set.
 */
function collectConfigSlots(config: IApiDirectCallConfig, slots: Set<string>): Set<string> {
  for (const source of config.seedCarryFromCreds ?? []) {
    slots.add(typeof source === 'string' ? source : source.field);
  }
  for (const derived of config.derivedCarry ?? []) slots.add(derived.into);
  for (const slot of config.sessionCarry ?? []) slots.add(slot);
  collectWarmSlots(config.warmStart, slots);
  collectDurableSlots(config, slots);
  for (const step of config.steps) collectExtractSlots(step, slots);
  return slots;
}

/**
 * Collect every config secret key.
 * @param config - Bank api-direct config.
 * @param keys - Target set.
 * @returns The target set.
 */
function collectSecretKeys(config: IApiDirectCallConfig, keys: Set<string>): Set<string> {
  for (const key of Object.keys(config.secrets ?? {})) keys.add(key);
  return keys;
}

/**
 * Collect carry slots and secret names from the registered bank configs.
 * @returns Sorted, unique names.
 */
function configFacts(): IConfigFacts {
  const carry = new Set<string>();
  const secret = new Set<string>();
  for (const entry of Object.values(BANK_PIPELINE_TABLE)) {
    collectConfigSlots(entry.config, carry);
    collectSecretKeys(entry.config, secret);
  }
  return { carrySlots: [...carry].sort(), secretKeys: [...secret].sort() };
}

/**
 * Log one payload through the production pino paths and censor.
 * @param payload - Object to log.
 * @returns Serialized log output.
 */
function logRedacted(payload: Readonly<Record<string, unknown>>): string {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const censor = createCensorFn() as unknown as (value: unknown, path: string[]) => unknown;
  const options = buildSilentOptions();
  const paths = options.redact as { paths: readonly string[] };
  const redact = { paths: [...paths.paths], censor };
  const sink = pino({ ...options, level: 'info', redact }, stream);
  sink.info(payload, 'redaction invariant probe');
  return output;
}

/**
 * Markers that survived in the log output.
 * @param output - Serialized log output.
 * @param markers - Marker record.
 * @returns The leaked markers, in record order.
 */
function leakedMarkers(
  output: string,
  markers: Readonly<Record<string, string>>,
): readonly string[] {
  return Object.values(markers).filter(marker => output.includes(marker));
}

const FACTS = configFacts();
const CREDENTIAL_MARKERS = markersFor(CREDENTIAL_KEYS);
const CARRY_MARKERS = markersFor(FACTS.carrySlots);
const SECRET_MARKERS = markersFor(FACTS.secretKeys);
const HEADER_MARKERS = markersFor(HEADER_NAMES);

describe('redaction invariant', () => {
  it('reaches the production sink', () => {
    const output = logRedacted({ safe: 'value' });
    expect(output).toContain('redaction invariant probe');
  });

  it('lists every credential key at compile time', () => {
    expect(hasAllCredentialKeys).toBe(true);
  });

  it('censors every credential key at the top level', () => {
    const output = logRedacted(CREDENTIAL_MARKERS);
    const leaked = leakedMarkers(output, CREDENTIAL_MARKERS);
    expect(leaked).toEqual([]);
  });

  it('censors every key inside a credentials object', () => {
    const output = logRedacted({ credentials: CREDENTIAL_MARKERS });
    const leaked = leakedMarkers(output, CREDENTIAL_MARKERS);
    expect(leaked).toEqual([]);
  });

  it('censors every carry slot registered by a bank config', () => {
    const output = logRedacted({ carry: CARRY_MARKERS });
    const leaked = leakedMarkers(output, CARRY_MARKERS);
    expect(leaked).toEqual([]);
  });

  it('censors every config secret key', () => {
    const output = logRedacted({ secrets: SECRET_MARKERS });
    const leaked = leakedMarkers(output, SECRET_MARKERS);
    expect(leaked).toEqual([]);
  });

  it('censors durable state fields at the top level', () => {
    const durable = markersFor(['accessToken', 'ecPrivateKeyPkcs8Base64']);
    const output = logRedacted(durable);
    const leaked = leakedMarkers(output, durable);
    expect(leaked).toEqual([]);
  });

  it('censors header values at the top level and under a request', () => {
    const output = logRedacted({
      headers: HEADER_MARKERS,
      request: { headers: HEADER_MARKERS },
    });
    const leaked = leakedMarkers(output, HEADER_MARKERS);
    expect(leaked).toEqual([]);
  });
});
