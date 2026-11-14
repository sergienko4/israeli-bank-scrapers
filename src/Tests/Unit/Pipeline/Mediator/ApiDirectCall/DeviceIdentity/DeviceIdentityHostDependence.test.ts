/**
 * RiskMinder MFP host-dependence characterization. The per-user seed is
 * stable, so any field that differs when only the host profile changes is a
 * host fact sent to the bank. This list is the evidence a later decision uses
 * to choose between synthetic seed-derived facts and a privacy disclosure.
 */

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { IDeviceProfile } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceIdentity/DeviceIdentityTypes.js';
import RISK_MINDER_MFP_FORMAT from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceIdentity/Formats/RiskMinderMfp.js';

/** One fixed seed for both profiles. */
const SEED = '0123456789abcdef';

/** Host facts A. */
const PROFILE_A: IDeviceProfile = {
  hostName: 'host-a',
  platform: 'linux',
  arch: 'x64',
  cpuModel: 'cpu-a',
  cpuCount: 4,
  totalMemory: 8_000_000_000,
  locale: 'en-US',
  timeZone: 'UTC',
  userAgent: 'agent-a',
  network: {
    ipAddress: '192.0.2.10',
    netmaskAddress: '255.255.255.0',
    macAddress: '02:00:00:00:00:01',
    gatewayAddress: '192.0.2.1',
    broadcastAddress: '192.0.2.255',
  },
};

/** Host facts B. */
const PROFILE_B: IDeviceProfile = {
  hostName: 'host-b',
  platform: 'darwin',
  arch: 'arm64',
  cpuModel: 'cpu-b',
  cpuCount: 8,
  totalMemory: 16_000_000_000,
  locale: 'he-IL',
  timeZone: 'Asia/Jerusalem',
  userAgent: 'agent-b',
  network: {
    ipAddress: '198.51.100.20',
    netmaskAddress: '255.255.0.0',
    macAddress: '02:00:00:00:00:02',
    gatewayAddress: '198.51.0.1',
    broadcastAddress: '198.51.255.255',
  },
};

/** The leaf paths that follow the host, in signature order. */
const HOST_DEPENDENT_PATHS: readonly string[] = [
  'deviceSignature.system.deviceName',
  'deviceSignature.system.model',
  'deviceSignature.system.board',
  'deviceSignature.system.host',
  'deviceSignature.system.cpuAbi',
  'deviceSignature.system.hardware',
  'deviceSignature.system.locale',
  'deviceSignature.system.timeZone',
  'deviceSignature.system.totalMemory',
  'deviceSignature.system.numberOfProcessors',
  'deviceSignature.browser.userAgent',
  'deviceSignature.wifi.macAddress',
  'deviceSignature.wifi.ipAddress',
  'deviceSignature.wifi.netmaskAddress',
  'deviceSignature.wifi.gatewayAddress',
  'deviceSignature.wifi.broadcastAddress',
  'ipAddress',
];

interface ILeaf {
  readonly path: string;
  readonly value: unknown;
}

/**
 * Parse one generated signature.
 * @param profile - Host facts.
 * @returns Parsed JSON.
 */
function generate(profile: IDeviceProfile): unknown {
  const result = RISK_MINDER_MFP_FORMAT.generate(profile, SEED);
  if (!result.success) throw new ScraperError(result.errorMessage);
  return JSON.parse(result.value);
}

/**
 * Every leaf in a JSON value.
 * @param value - JSON value.
 * @param path - Current path prefix.
 * @returns Leaf path and value pairs.
 */
function leavesOf(value: unknown, path = ''): ILeaf[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [{ path, value }];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const childPath = path === '' ? key : `${path}.${key}`;
    return leavesOf(child, childPath);
  });
}

/**
 * Leaf paths whose value differs between two JSON values.
 * @param left - First JSON value.
 * @param right - Second JSON value.
 * @returns Differing paths in left-hand order.
 */
function differingPaths(left: unknown, right: unknown): string[] {
  const rightLeaves = new Map(leavesOf(right).map(leaf => [leaf.path, leaf.value]));
  return leavesOf(left)
    .filter(leaf => rightLeaves.get(leaf.path) !== leaf.value)
    .map(leaf => leaf.path);
}

/**
 * The stable Android id of a parsed signature.
 * @param value - Parsed signature.
 * @returns The id, or ''.
 */
function androidIdOf(value: unknown): string {
  const parsed = value as { deviceSignature?: { system?: { androidId?: string } } };
  return parsed.deviceSignature?.system?.androidId ?? '';
}

describe('RiskMinder MFP host dependence', () => {
  it('pins exactly the fields that follow the host profile', () => {
    const first = generate(PROFILE_A);
    const second = generate(PROFILE_B);
    const differing = differingPaths(first, second);
    expect(differing).toEqual(HOST_DEPENDENT_PATHS);
  });

  it('keeps the seed-derived identity fields stable across hosts', () => {
    const first = generate(PROFILE_A);
    const second = generate(PROFILE_B);
    const firstId = androidIdOf(first);
    const secondId = androidIdOf(second);
    expect(firstId).toBe(SEED);
    expect(secondId).toBe(SEED);
  });
});
