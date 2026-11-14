/**
 * Device-identity provider — the override, token-seed and fresh-seed edges:
 * a missing scope, a warm start that cannot carry the seed, an unusable
 * token, an invalid override, an unknown format and a failing generator.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type {
  ICarryBundleWarmStart,
  ICookieJarWarmStart,
  IDeviceIdentityConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { deviceIdentityEnricherOf } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceIdentity/DeviceIdentityEnricher.js';
import createDeviceIdentityProvider from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceIdentity/DeviceIdentityProvider.js';
import type {
  IDeviceProfile,
  IDeviceSignatureFormat,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceIdentity/DeviceIdentityTypes.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** A user-scoped Hapoalim-shaped declaration. */
const CONFIG: IDeviceIdentityConfig = {
  credential: 'deviceSignature',
  format: 'risk-minder-mfp',
  seedSlot: 'deviceSeed',
  scopeField: 'userCode',
};

/** A carry-bundle warm start that keeps the seed. */
const WARM: ICarryBundleWarmStart = {
  kind: 'carry-bundle',
  credsField: 'otpLongTermToken',
  fromStepIndex: 1,
  validation: 'bank-call',
  provider: 'test',
  accountFields: ['userCode'],
  slots: ['deviceSeed'],
  maxTokenChars: 4096,
  cookies: false,
  coldFallback: 'auth-rejected',
};

/** A warm start that cannot carry the seed. */
const JAR: ICookieJarWarmStart = {
  kind: 'cookie-jar',
  credsField: 'otpLongTermToken',
  fromStepIndex: 1,
  validation: 'bank-call',
  provider: 'test',
  accountField: 'userCode',
  maxTokenChars: 4096,
};

/** Credentials a derivation can succeed on. */
const CREDS: ScraperCredentials = { userCode: 'user-a', password: 'pass-a' };

/** A synthetic host profile for the injected-reader test. */
const PROFILE: IDeviceProfile = {
  hostName: 'fixture-host',
  platform: 'linux',
  arch: 'x64',
  cpuModel: 'fixture-cpu',
  cpuCount: 4,
  totalMemory: 8_000_000_000,
  locale: 'en-US',
  timeZone: 'UTC',
  userAgent: 'fixture-agent',
  network: {
    ipAddress: '192.0.2.10',
    netmaskAddress: '255.255.255.0',
    macAddress: '02:00:00:00:00:01',
    gatewayAddress: '192.0.2.1',
    broadcastAddress: '192.0.2.255',
  },
};

/**
 * The raw signature a successful enrichment injected.
 * @param result - Enrichment result.
 * @returns The signature, or '' on failure.
 */
function signatureOf(result: Procedure<ScraperCredentials>): string {
  if (!result.success) return '';
  const value = (result.value as { deviceSignature?: string }).deviceSignature;
  return value ?? '';
}

/**
 * The enricher for a config and warm start, or a failed expectation.
 * @param warm - Warm-start config.
 * @returns The enricher.
 */
function enricherOf(
  warm: ICarryBundleWarmStart | ICookieJarWarmStart,
): (creds: ScraperCredentials) => Procedure<ScraperCredentials> {
  const enricher = deviceIdentityEnricherOf(CONFIG, warm);
  if (!enricher.has) throw new ScraperError('device identity enricher missing');
  return enricher.value;
}

describe('device-identity provider edges', () => {
  it('fails a scoped identity when the scope credential is missing', () => {
    const result = enricherOf(WARM)({ userCode: '', password: 'pass-a' });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'device identity scope missing',
    });
  });

  it('creates a fresh seed when the warm start is not a carry bundle', () => {
    const enrich = enricherOf(JAR);
    const result = enrich({ ...CREDS, otpLongTermToken: 'stored' });
    const signature = signatureOf(result);
    expect(signature).not.toBe('');
  });

  it('creates a fresh seed when the warm start keeps no seed slot', () => {
    const warm = { ...WARM, slots: ['other'] };
    const enrich = enricherOf(warm);
    const result = enrich({ ...CREDS, otpLongTermToken: 'stored' });
    const signature = signatureOf(result);
    expect(signature).not.toBe('');
  });

  it('creates a fresh seed when the token is unusable', () => {
    const enrich = enricherOf(WARM);
    const result = enrich({ ...CREDS, otpLongTermToken: 'not-a-token' });
    const signature = signatureOf(result);
    expect(signature).not.toBe('');
  });

  it('rejects an invalid caller override', () => {
    const enrich = enricherOf(WARM);
    const result = enrich({ ...CREDS, deviceSignature: 'not-json' });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'device signature invalid',
    });
  });

  it('keeps a valid caller override unchanged', () => {
    const supplied = '{"deviceSignature":{"system":{"androidId":"x"}}}';
    const enrich = enricherOf(WARM);
    const result = enrich({ ...CREDS, deviceSignature: supplied });
    const signature = signatureOf(result);
    expect(signature).toBe(supplied);
  });

  it('returns no enricher when the bank declares no device identity', () => {
    const enricher = deviceIdentityEnricherOf();
    expect(enricher.has).toBe(false);
  });

  it('reports an unknown format at build time and on every enrich', () => {
    const unknown = { ...CONFIG, format: 'unknown' };
    const built = createDeviceIdentityProvider(unknown, WARM, { formats: {} });
    expect(built).toMatchObject({
      success: false,
      errorMessage: 'device identity format unknown',
    });
    const enricher = deviceIdentityEnricherOf(unknown, WARM);
    if (!enricher.has) throw new ScraperError('device identity enricher missing');
    const result = enricher.value(CREDS);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'device identity format unknown',
    });
  });

  it('generates from the injected host profile', () => {
    const built = createDeviceIdentityProvider(CONFIG, WARM, {
      /**
       * Return the synthetic profile.
       * @returns The fixture profile.
       */
      readProfile: () => PROFILE,
    });
    if (!built.success) throw new ScraperError(built.errorMessage);
    const result = built.value.ensure(CREDS);
    const signature = signatureOf(result);
    const parsed = JSON.parse(signature) as {
      deviceSignature?: {
        system?: { deviceName?: string; host?: string };
        wifi?: { macAddress?: string; ipAddress?: string };
      };
    };
    expect(parsed.deviceSignature?.system?.deviceName).toBe('fixture-host');
    expect(parsed.deviceSignature?.system?.host).toBe('fixture-host');
    expect(parsed.deviceSignature?.wifi?.macAddress).toBe('02:00:00:00:00:01');
    expect(parsed.deviceSignature?.wifi?.ipAddress).toBe('192.0.2.10');
  });

  it('propagates a format generation failure', () => {
    const failing: IDeviceSignatureFormat = {
      key: 'risk-minder-mfp',
      /**
       * Accept any caller value.
       * @returns Success.
       */
      validate: () => succeed(true),
      /**
       * Fail every generation.
       * @returns The failure.
       */
      generate: () => fail(ScraperErrorTypes.Generic, 'generate failed'),
    };
    const built = createDeviceIdentityProvider(CONFIG, WARM, {
      formats: { 'risk-minder-mfp': failing },
    });
    if (!built.success) throw new ScraperError(built.errorMessage);
    const result = built.value.ensure(CREDS);
    expect(result).toMatchObject({ success: false, errorMessage: 'generate failed' });
  });
});
