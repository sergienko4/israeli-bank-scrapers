/**
 * Minimal runtime device collection for website SDKs.
 */

import { release, type as osType } from 'node:os';

import type { IFingerprintConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

const DEVICE_DETAILS = {
  os_type: osType(),
  os_version: release(),
  device_model: `Node.js ${process.versions.node}`,
  device_platform: process.platform,
  timezone_offset: new Date().getTimezoneOffset(),
};

/**
 * Describes the actual runtime and the SDK application's host.
 * @param origin - Website origin.
 * @returns Timestamped collection without location.
 */
function deviceFingerprint(origin: string): IFingerprintConfig {
  const { host } = new URL(origin);
  const metadata = { timestamp: { $ref: 'nowMs' }, physical_app_id: { $literal: host } } as const;
  const content = {
    device_details: { $literal: DEVICE_DETAILS },
    location: { $literal: { enabled: false } },
  };
  return { shape: { metadata, content } };
}

export default deviceFingerprint;
