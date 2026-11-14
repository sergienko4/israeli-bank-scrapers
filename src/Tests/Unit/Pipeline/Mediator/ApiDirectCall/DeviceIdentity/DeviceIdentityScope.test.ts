/**
 * Device-identity token seed — the same carry-bundle seed derives the same
 * device for one user, while another user's token derives a different one.
 */

import type { ScraperCredentials } from '../../../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type {
  IDeviceIdentityConfig,
  IWarmStartConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { deviceIdentityEnricherOf } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceIdentity/DeviceIdentityEnricher.js';
import { encodeWarmBundle } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmCarryBundle.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** A user-scoped Hapoalim device identity carried by the warm token. */
const CONFIG: IDeviceIdentityConfig = {
  credential: 'deviceSignature',
  format: 'risk-minder-mfp',
  seedSlot: 'deviceSeed',
  scopeField: 'userCode',
};

/** The carry-bundle warm start that keeps the seed. */
const WARM: IWarmStartConfig = {
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

/**
 * The raw signature a successful enrichment injected.
 * @param result - Enrichment result.
 * @returns The signature.
 */
function signatureOf(result: Procedure<ScraperCredentials>): string {
  if (!result.success) throw new ScraperError(result.errorMessage);
  const value = (result.value as { deviceSignature?: string }).deviceSignature;
  if (value === undefined || value === '') throw new ScraperError('device signature missing');
  return value;
}

/**
 * The stable Android id inside a generated signature.
 * @param signature - Raw RiskMinder JSON.
 * @returns The id, or '' when the shape is wrong.
 */
function androidIdOf(signature: string): string {
  const parsed = JSON.parse(signature) as {
    deviceSignature?: { system?: { androidId?: string } };
  };
  return parsed.deviceSignature?.system?.androidId ?? '';
}

/**
 * Build a token for one user and seed.
 * @param user - User code.
 * @param seed - Device seed.
 * @returns The carry-bundle token.
 */
function tokenOf(user: string, seed: string): string {
  const encoded = encodeWarmBundle(
    { provider: 'test', accounts: [user] },
    { carry: { deviceSeed: seed }, cookies: false },
  );
  if (!encoded.success) throw new ScraperError(encoded.errorMessage);
  return encoded.value;
}

describe('device-identity token seed', () => {
  it('derives the same identity from the same token and a different one per user', () => {
    const enricher = deviceIdentityEnricherOf(CONFIG, WARM);
    if (!enricher.has) throw new ScraperError('device identity enricher missing');
    const tokenA = tokenOf('user-a', '0123456789abcdef');
    const tokenB = tokenOf('user-b', 'fedcba9876543210');
    const first = enricher.value({
      userCode: 'user-a',
      password: 'pass-a',
      otpLongTermToken: tokenA,
    });
    const again = enricher.value({
      userCode: 'user-a',
      password: 'pass-a',
      otpLongTermToken: tokenA,
    });
    const other = enricher.value({
      userCode: 'user-b',
      password: 'pass-b',
      otpLongTermToken: tokenB,
    });
    const firstSignature = signatureOf(first);
    const againSignature = signatureOf(again);
    const otherSignature = signatureOf(other);
    const firstId = androidIdOf(firstSignature);
    const againId = androidIdOf(againSignature);
    const otherId = androidIdOf(otherSignature);
    expect(firstId).not.toBe('');
    expect(againId).toBe(firstId);
    expect(otherId).not.toBe(firstId);
  });

  it('binds the same seed to each user, so their signatures differ', () => {
    const enricher = deviceIdentityEnricherOf(CONFIG, WARM);
    if (!enricher.has) throw new ScraperError('device identity enricher missing');
    const sharedSeed = '0123456789abcdef';
    const tokenA = tokenOf('user-a', sharedSeed);
    const tokenB = tokenOf('user-b', sharedSeed);
    const first = enricher.value({
      userCode: 'user-a',
      password: 'pass-a',
      otpLongTermToken: tokenA,
    });
    const second = enricher.value({
      userCode: 'user-b',
      password: 'pass-b',
      otpLongTermToken: tokenB,
    });
    const firstSignature = signatureOf(first);
    const secondSignature = signatureOf(second);
    const firstId = androidIdOf(firstSignature);
    const secondId = androidIdOf(secondSignature);
    expect(firstId).not.toBe('');
    expect(firstId).not.toBe(secondId);
  });

  it('uses a fresh seed when the token is absent', () => {
    const enricher = deviceIdentityEnricherOf(CONFIG, WARM);
    if (!enricher.has) throw new ScraperError('device identity enricher missing');
    const first = enricher.value({ userCode: 'user-a', password: 'pass-a' });
    const second = enricher.value({ userCode: 'user-a', password: 'pass-a' });
    const firstSignature = signatureOf(first);
    const secondSignature = signatureOf(second);
    const firstId = androidIdOf(firstSignature);
    const secondId = androidIdOf(secondSignature);
    expect(firstId).not.toBe('');
    expect(firstId).not.toBe(secondId);
  });
});
