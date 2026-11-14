/**
 * RiskMinder MFP format — pins the schema the bank parses and the validation
 * contract a stored signature must pass before it is sent.
 */

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { IDeviceProfile } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceIdentity/DeviceIdentityTypes.js';
import RISK_MINDER_MFP_FORMAT from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceIdentity/Formats/RiskMinderMfp.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** A host profile with no real host data. */
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
 * Unwrap a successful Procedure or fail the test through the project error.
 * @param result - Procedure under test.
 * @returns The success value.
 */
function expectOk<T>(result: Procedure<T>): T {
  if (!result.success) throw new ScraperError(result.errorMessage);
  return result.value;
}

describe('RiskMinder MFP format', () => {
  it('generates the schema the bank parses', () => {
    const result = RISK_MINDER_MFP_FORMAT.generate(PROFILE, '0123456789abcdef');
    const generated = expectOk(result);
    const parsed = JSON.parse(generated) as Record<string, unknown>;
    const signature = parsed.deviceSignature as Record<string, unknown>;
    const system = signature.system as Record<string, unknown>;
    expect(signature.collector).toBe('Android');
    expect(system.androidId).toBe('0123456789abcdef');
    expect(system.deviceName).toBe('fixture-host');
    expect(parsed.ipAddress).toBe('192.0.2.10');
    expect(RISK_MINDER_MFP_FORMAT.key).toBe('risk-minder-mfp');
  });

  it('accepts a generated value and rejects a malformed one', () => {
    const result = RISK_MINDER_MFP_FORMAT.generate(PROFILE, '0123456789abcdef');
    const generated = expectOk(result);
    const accepted = RISK_MINDER_MFP_FORMAT.validate(generated);
    const rejected = RISK_MINDER_MFP_FORMAT.validate('{}');
    expect(accepted).toEqual({ success: true, value: true });
    expect(rejected).toMatchObject({ success: false, errorMessage: 'device signature invalid' });
  });

  it.each([
    { label: 'an empty value', value: '' },
    { label: 'a non-JSON value', value: 'not-json' },
    { label: 'a JSON array', value: '[]' },
    { label: 'a value with no Android id', value: '{"deviceSignature":{"system":{}}}' },
    { label: 'a system value that is not an object', value: '{"deviceSignature":{"system":"x"}}' },
    { label: 'an oversize value', value: 'x'.repeat(8193) },
  ])('rejects $label', ({ value }) => {
    const rejected = RISK_MINDER_MFP_FORMAT.validate(value);
    expect(rejected).toMatchObject({ success: false, errorMessage: 'device signature invalid' });
  });
});
