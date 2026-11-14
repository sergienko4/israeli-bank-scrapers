/**
 * Device-identity provider — the generic enricher the pipeline runs before
 * login. A caller-supplied credential wins; otherwise the long-term token's
 * seed (or a fresh random seed when the token is absent) derives the signature
 * at runtime. No device value is stored.
 */

import { createHmac, randomBytes } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../Base/Interface.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type {
  ICarryBundleWarmStart,
  IDeviceIdentityConfig,
  IWarmStartConfig,
} from '../ConfigContracts/index.js';
import { decodeWarmBundle } from '../Flow/WarmCarryBundle.js';
import type {
  IDeviceIdentityProvider,
  IDeviceProfile,
  IDeviceSignatureFormat,
} from './DeviceIdentityTypes.js';
import DEVICE_SIGNATURE_FORMATS from './DeviceSignatureFormats.js';
import readHostProfile from './HostProfile.js';

/** Fixed failure when the bank names a format no adapter registered. */
const UNKNOWN_FORMAT = 'device identity format unknown';

/** Fixed failure when the scope credential is missing. */
const MISSING_SCOPE = 'device identity scope missing';

/** Bytes in a generated seed, and the hex seed prefix length. */
const SEED_BYTES = 8;
const SEED_CHARS = 16;

/** The credential-enrichment result the pipeline builder consumes. */
type Enriched = Procedure<ScraperCredentials>;

/** The expectation argument the carry-bundle decoder takes. */
type WarmExpectation = Parameters<typeof decodeWarmBundle>[1];

/** One resolved device-identity runtime: config, format and warm start. */
interface IRuntime {
  readonly config: IDeviceIdentityConfig;
  readonly format: IDeviceSignatureFormat;
  readonly warmStart: IWarmStartConfig | undefined;
  readonly readProfile: () => IDeviceProfile;
}

/** Optional provider seams for tests and alternate hosts. */
interface IProviderOptions {
  readonly formats?: Readonly<Record<string, IDeviceSignatureFormat>>;
  readonly readProfile?: () => IDeviceProfile;
}

/** The raw token seed and the signature seed derived from it. */
interface IDeviceSeeds {
  readonly deviceSeed: string;
  readonly signatureSeed: string;
}

/** One warm token and the seed slot to read from it. */
interface IWarmTokenSource {
  readonly credentials: ScraperCredentials;
  readonly warmStart: ICarryBundleWarmStart;
  readonly seedSlot: string;
}

/**
 * Read the configured field from an untyped credential bag.
 * @param credentials - Caller credentials.
 * @param field - Configured credential name.
 * @returns The non-empty value, or ''.
 */
function suppliedValue(credentials: ScraperCredentials, field: string): string {
  const value = (credentials as unknown as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value : '';
}

/**
 * Return credentials with the seed and signature fields set.
 * @param credentials - Caller credentials.
 * @param config - Bank device-identity declaration.
 * @param values - Raw seed and signature.
 * @returns Enriched credentials.
 */
function withValues(
  credentials: ScraperCredentials,
  config: IDeviceIdentityConfig,
  values: readonly [string, string],
): ScraperCredentials {
  const [deviceSeed, signature] = values;
  return { ...credentials, [config.seedSlot]: deviceSeed, [config.credential]: signature };
}

/**
 * The decoder expectation a source's warm config describes.
 * @param source - Warm token, its config and the seed slot.
 * @returns The expectation the decoder validates.
 */
function expectationOf(source: IWarmTokenSource): WarmExpectation {
  const accounts = source.warmStart.accountFields.map((field): string =>
    suppliedValue(source.credentials, field),
  );
  const { provider, slots, cookies: hasCookies, maxTokenChars } = source.warmStart;
  return { provider, accounts, slots, hasCookies, maxChars: maxTokenChars };
}

/**
 * Read the seed a carry-bundle token already holds.
 * @param source - Warm token, its config and the seed slot.
 * @returns The seed, or '' when the token is absent or unusable.
 */
function carriedSeed(source: IWarmTokenSource): string {
  const token = suppliedValue(source.credentials, source.warmStart.credsField);
  if (token === '') return '';
  const expected = expectationOf(source);
  const decoded = decodeWarmBundle(token, expected);
  return isOk(decoded) ? decoded.value.carry[source.seedSlot] : '';
}

/**
 * Read the token seed when the warm start carries this seed slot.
 * @param credentials - Caller credentials.
 * @param config - Bank device-identity declaration.
 * @param warmStart - Bank warm-start config, when present.
 * @returns The token seed, or '' when no usable token exists.
 */
function tokenSeedOf(
  credentials: ScraperCredentials,
  config: IDeviceIdentityConfig,
  warmStart?: IWarmStartConfig,
): string {
  if (warmStart?.kind !== 'carry-bundle') return '';
  if (!warmStart.slots.includes(config.seedSlot)) return '';
  return carriedSeed({ credentials, warmStart, seedSlot: config.seedSlot });
}

/**
 * Derive the signature seed from the token (or fresh) seed and the scope.
 * @param deviceSeed - Raw token seed, or a fresh random one.
 * @param scope - Scope value the seed binds to.
 * @returns First 16 hex chars of the HMAC.
 */
function signatureSeedOf(deviceSeed: string, scope: string): string {
  const digest = createHmac('sha256', deviceSeed).update(scope, 'utf8').digest('hex');
  return digest.slice(0, SEED_CHARS);
}

/**
 * Resolve the raw and signature seeds for this run.
 * @param runtime - Resolved device-identity runtime.
 * @param credentials - Caller credentials.
 * @returns The seeds, or a typed failure.
 */
function seedsOf(runtime: IRuntime, credentials: ScraperCredentials): Procedure<IDeviceSeeds> {
  const scope = suppliedValue(credentials, runtime.config.scopeField);
  if (scope === '') return fail(ScraperErrorTypes.Generic, MISSING_SCOPE);
  const stored = tokenSeedOf(credentials, runtime.config, runtime.warmStart);
  const deviceSeed = stored !== '' ? stored : randomBytes(SEED_BYTES).toString('hex');
  return succeed({ deviceSeed, signatureSeed: signatureSeedOf(deviceSeed, scope) });
}

/**
 * Validate a caller-supplied signature override.
 * @param runtime - Resolved device-identity runtime.
 * @param credentials - Caller credentials.
 * @returns The validated value, or false when no override was supplied.
 */
function overrideOf(runtime: IRuntime, credentials: ScraperCredentials): Procedure<string> | false {
  const value = suppliedValue(credentials, runtime.config.credential);
  if (value === '') return false;
  const checked = runtime.format.validate(value);
  return isOk(checked) ? succeed(value) : checked;
}

/**
 * Resolve the signature: the caller's override or a generated one.
 * @param runtime - Resolved device-identity runtime.
 * @param credentials - Caller credentials.
 * @param signatureSeed - Seed derived from the token and scope.
 * @returns The raw signature, or a typed failure.
 */
function signatureOf(
  runtime: IRuntime,
  credentials: ScraperCredentials,
  signatureSeed: string,
): Procedure<string> {
  const override = overrideOf(runtime, credentials);
  if (override !== false) return override;
  const profile = runtime.readProfile();
  return runtime.format.generate(profile, signatureSeed);
}

/**
 * Fill the configured credential when the caller did not supply it.
 * @param runtime - Resolved device-identity runtime.
 * @param credentials - Caller credentials.
 * @returns Enriched credentials, or a typed failure.
 */
function ensureFor(runtime: IRuntime, credentials: ScraperCredentials): Enriched {
  const seeds = seedsOf(runtime, credentials);
  if (!isOk(seeds)) return seeds;
  const signature = signatureOf(runtime, credentials, seeds.value.signatureSeed);
  if (!isOk(signature)) return signature;
  const values: readonly [string, string] = [seeds.value.deviceSeed, signature.value];
  const enriched = withValues(credentials, runtime.config, values);
  return succeed(enriched);
}

/**
 * Build the provider object for one resolved runtime.
 * @param runtime - Resolved device-identity runtime.
 * @returns The provider, or the runtime's failure.
 */
function providerOf(runtime: IRuntime): Procedure<IDeviceIdentityProvider> {
  /**
   * The provider's one method.
   * @param credentials - Caller credentials.
   * @returns Enriched credentials, or a typed failure.
   */
  const ensure = (credentials: ScraperCredentials): Procedure<ScraperCredentials> =>
    ensureFor(runtime, credentials);
  return succeed({ ensure });
}

/**
 * Resolve the format and host-profile reader for one declaration.
 * @param config - Bank device-identity declaration.
 * @param options - Optional format registry and profile reader.
 * @param warmStart - Bank warm-start config, when it carries the seed.
 * @returns The runtime, or false for an unknown format.
 */
function runtimeOf(
  config: IDeviceIdentityConfig,
  options: IProviderOptions,
  warmStart?: IWarmStartConfig,
): IRuntime | false {
  const formats = options.formats ?? DEVICE_SIGNATURE_FORMATS;
  const format = Object.hasOwn(formats, config.format) ? formats[config.format] : false;
  if (format === false) return false;
  return { config, format, warmStart, readProfile: options.readProfile ?? readHostProfile };
}

/**
 * Build the generic provider from one bank's device-identity config.
 * @param config - Bank device-identity declaration.
 * @param warmStart - Bank warm-start config, when it carries the seed.
 * @param options - Optional format registry and profile reader.
 * @returns The provider, or a fixed failure for an unknown format.
 */
function createDeviceIdentityProvider(
  config: IDeviceIdentityConfig,
  warmStart?: IWarmStartConfig,
  options: IProviderOptions = {},
): Procedure<IDeviceIdentityProvider> {
  const runtime = runtimeOf(config, options, warmStart);
  if (runtime === false) return fail(ScraperErrorTypes.Generic, UNKNOWN_FORMAT);
  return providerOf(runtime);
}

export default createDeviceIdentityProvider;
