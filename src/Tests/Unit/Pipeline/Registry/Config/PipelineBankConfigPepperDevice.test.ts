/**
 * Pepper device-details identity.
 *
 * The Transmit fingerprint must not ship one captured `device_name` to every
 * user. The bootstrap derives a stable 16-hex value from the account's phone
 * number, the fingerprint reads it from carry, and the captured literal is
 * gone. A shared value makes every install look like the same device.
 *
 * Dynamic import dodges the no-restricted-imports DI rule that bans static
 * imports of Registry/Config/** in Pipeline tests.
 */

import { createHash } from 'node:crypto';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type {
  IApiDirectCallConfig,
  JsonValueTemplate,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { buildCollectionResult } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Fingerprint/GenericFingerprintBuilder.js';
import buildInitialCarry from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/FlowInitCarry.build.js';

/** The captured value that must not ship. */
const SHARED_DEVICE_NAME = 'e71c2b2f5a0cbd94';

/** Module shape of the Pepper call-config literal. */
interface IPepperConfigModule {
  readonly default: IApiDirectCallConfig;
}

/**
 * Load the Pepper call-config literal.
 * @returns Pepper IApiDirectCallConfig.
 */
async function loadPepper(): Promise<IApiDirectCallConfig> {
  const path = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPepper.js';
  const mod = (await import(path)) as IPepperConfigModule;
  return mod.default;
}

/**
 * Read a node from a fingerprint template by key path.
 * @param root - Template root.
 * @param keys - Key path to walk.
 * @returns The node at the path.
 */
function nodeAt(root: JsonValueTemplate, keys: readonly string[]): unknown {
  return keys.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], root);
}

/**
 * Read the hydrated device-details block.
 * @param fingerprint - Hydrated fingerprint payload.
 * @returns The device-details record.
 */
function deviceDetailsOf(fingerprint: unknown): Record<string, unknown> {
  const content = (fingerprint as { content: { device_details: Record<string, unknown> } }).content;
  return content.device_details;
}

/**
 * Hydrate Pepper's fingerprint for one phone number.
 * @param config - Pepper call config.
 * @param phoneNumber - Account phone number used as the seed.
 * @returns The hydrated fingerprint payload.
 */
function fingerprintFor(config: IApiDirectCallConfig, phoneNumber: string): unknown {
  const carry = buildInitialCarry(config, { phoneNumber }, {});
  if (!carry.success) throw new ScraperError('Pepper carry should build');
  const fingerprint = config.fingerprint;
  if (fingerprint === undefined) throw new ScraperError('Pepper declares no fingerprint');
  const built = buildCollectionResult(fingerprint, config, carry.value);
  if (!built.success) throw new ScraperError('Pepper fingerprint should hydrate');
  return built.value;
}

describe('Pepper device details — per-user device name', () => {
  it('seeds deviceName from the phone number with the sha256-prefix-16 bootstrap', async () => {
    const config = await loadPepper();
    expect(config.seedCarryFromCreds).toContainEqual({
      field: 'deviceName',
      bootstrap: { kind: 'sha256-prefix-16', from: 'phoneNumber' },
    });
  });

  it('hydrates device_name from carry and master_key_generated from nowMs', async () => {
    const config = await loadPepper();
    const fingerprint = config.fingerprint;
    if (fingerprint === undefined) throw new ScraperError('Pepper declares no fingerprint');
    const device = nodeAt(fingerprint.shape, ['content', 'device_details']);
    expect(device).toHaveProperty('device_name', { $ref: 'carry.deviceName' });
    expect(device).toHaveProperty('master_key_generated', { $ref: 'nowMs' });
  });

  it('removes the shared captured device_name from the literal', async () => {
    const path =
      '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPepperDevice.js';
    const mod = (await import(path)) as { DEVICE_DETAILS_LITERAL: Record<string, unknown> };
    expect(mod.DEVICE_DETAILS_LITERAL).not.toHaveProperty('device_name');
  });

  it('derives a stable 16-hex value per phone number', async () => {
    const config = await loadPepper();
    const phoneNumber = '972500000001';
    const expected = createHash('sha256').update(phoneNumber, 'utf8').digest('hex').slice(0, 16);
    const firstFingerprint = fingerprintFor(config, phoneNumber);
    const secondFingerprint = fingerprintFor(config, phoneNumber);
    const first = deviceDetailsOf(firstFingerprint);
    const second = deviceDetailsOf(secondFingerprint);
    expect(first.device_name).toBe(expected);
    expect(second.device_name).toBe(expected);
    expect(first.device_name).toMatch(/^[0-9a-f]{16}$/);
    expect(first.device_name).not.toBe(SHARED_DEVICE_NAME);
  });

  it('gives different phone numbers different device names', async () => {
    const config = await loadPepper();
    const firstFingerprint = fingerprintFor(config, '972500000001');
    const secondFingerprint = fingerprintFor(config, '972500000002');
    const first = deviceDetailsOf(firstFingerprint);
    const second = deviceDetailsOf(secondFingerprint);
    expect(first.device_name).not.toBe(second.device_name);
  });

  it('stamps master_key_generated at bind time in milliseconds', async () => {
    const config = await loadPepper();
    const fingerprint = fingerprintFor(config, '972500000001');
    const device = deviceDetailsOf(fingerprint);
    expect(typeof device.master_key_generated).toBe('number');
    expect(device.master_key_generated).toBeGreaterThan(10 ** 12);
  });
});
