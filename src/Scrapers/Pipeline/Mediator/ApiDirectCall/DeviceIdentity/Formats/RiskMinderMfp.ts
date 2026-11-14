/**
 * RiskMinder MFP format — the JSON device signature the official mobile SDK
 * sends as `mfp`. The schema is the vendor's; the values are the host's real
 * profile where the vendor has a field, and neutral values where an Android
 * device would report hardware a Node host does not have.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { IDeviceProfile, IDeviceSignatureFormat } from '../DeviceIdentityTypes.js';
import {
  MFP_BLUETOOTH,
  MFP_CAMERA,
  MFP_EXTRA,
  MFP_LOCATION,
  MFP_SCREEN,
  MFP_SYSTEM_STATIC,
  MFP_TELEPHONY,
} from './RiskMinderMfpBlocks.js';

/** Registry key a bank names in `deviceIdentity.format`. */
const RISK_MINDER_MFP_KEY = 'risk-minder-mfp';

/** Longest stored signature accepted, in chars. */
const MAX_SIGNATURE_CHARS = 8192;

/** Fixed validation failure; no value or path is echoed. */
const INVALID = 'device signature invalid';

/** Collector identity and version the app's SDK reports. */
const COLLECTOR = 'Android';
const COLLECTOR_VERSION = '8.2.4.1';

/**
 * Whether a value is a non-array record.
 * @param value - Candidate.
 * @returns True for a plain record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The stable identity fields of the system block.
 * @param seed - Stable install id (16 hex).
 * @returns Platform, Android id, OS version, device id and type.
 */
function systemIdOf(seed: string): Record<string, unknown> {
  return {
    platform: 'Android34',
    androidId: seed,
    osVersion: '14',
    id: seed.toUpperCase(),
    type: 'user',
  };
}

/**
 * The build-like fields of the system block.
 * @param profile - Host facts.
 * @returns Device name, model, board and host.
 */
function systemDeviceOf(profile: IDeviceProfile): Record<string, unknown> {
  return {
    deviceName: profile.hostName,
    model: profile.cpuModel,
    board: profile.arch,
    host: profile.hostName,
  };
}

/**
 * The CPU fields of the system block.
 * @param profile - Host facts.
 * @returns ABI and hardware fields.
 */
function systemCpuOf(profile: IDeviceProfile): Record<string, unknown> {
  return { cpuAbi: profile.arch, hardware: profile.arch };
}

/**
 * The locale fields of the system block.
 * @param profile - Host facts.
 * @returns Locale and time zone.
 */
function systemLocaleOf(profile: IDeviceProfile): Record<string, unknown> {
  return { locale: profile.locale, timeZone: profile.timeZone };
}

/**
 * The capacity fields of the system block.
 * @param profile - Host facts.
 * @returns Memory and processor count.
 */
function systemCapacityOf(profile: IDeviceProfile): Record<string, unknown> {
  return { totalMemory: profile.totalMemory, numberOfProcessors: profile.cpuCount };
}

/**
 * The runtime fields of the system block.
 * @param profile - Host facts.
 * @returns Static host fields plus CPU, locale and capacity facts.
 */
function systemRuntimeOf(profile: IDeviceProfile): Record<string, unknown> {
  const cpu = systemCpuOf(profile);
  const locale = systemLocaleOf(profile);
  const capacity = systemCapacityOf(profile);
  return { ...MFP_SYSTEM_STATIC, ...cpu, ...locale, ...capacity };
}

/**
 * The system block: identity, build and runtime fields.
 * @param profile - Host facts.
 * @param seed - Stable install id.
 * @returns The system object.
 */
function systemOf(profile: IDeviceProfile, seed: string): Record<string, unknown> {
  const identity = systemIdOf(seed);
  const device = systemDeviceOf(profile);
  const runtime = systemRuntimeOf(profile);
  return { ...identity, ...device, ...runtime };
}

/**
 * The WiFi identity fields from the host's interface.
 * @param profile - Host facts.
 * @returns Connection, MAC and IP fields.
 */
function wifiIdentityOf(profile: IDeviceProfile): Record<string, unknown> {
  return {
    connected: true,
    macAddress: profile.network.macAddress,
    ipAddress: profile.network.ipAddress,
  };
}

/**
 * The WiFi addressing fields from the host's interface.
 * @param profile - Host facts.
 * @returns Netmask, gateway, broadcast and enablement fields.
 */
function wifiAddressOf(profile: IDeviceProfile): Record<string, unknown> {
  return {
    netmaskAddress: profile.network.netmaskAddress,
    gatewayAddress: profile.network.gatewayAddress,
    broadcastAddress: profile.network.broadcastAddress,
    userEnabled: true,
  };
}

/**
 * The WiFi block from the host's interface.
 * @param profile - Host facts.
 * @returns The wifi object.
 */
function wifiOf(profile: IDeviceProfile): Record<string, unknown> {
  return { ...wifiIdentityOf(profile), ...wifiAddressOf(profile) };
}

/**
 * The identity half of the device block.
 * @param profile - Host facts.
 * @param seed - Stable install id.
 * @returns Collector, system, screen and browser fields.
 */
function identityBlockOf(profile: IDeviceProfile, seed: string): Record<string, unknown> {
  return {
    collector: COLLECTOR,
    collectorVersion: COLLECTOR_VERSION,
    system: systemOf(profile, seed),
    screen: { displayId: seed, ...MFP_SCREEN },
    browser: { userAgent: profile.userAgent },
  };
}

/**
 * The network half of the device block.
 * @param profile - Host facts.
 * @returns WiFi and telephony blocks.
 */
function networkBlockOf(profile: IDeviceProfile): Record<string, unknown> {
  return { wifi: wifiOf(profile), telephony: MFP_TELEPHONY };
}

/**
 * The hardware half of the device block.
 * @returns Camera, Bluetooth, extra and location blocks.
 */
function hardwareBlockOf(): Record<string, unknown> {
  return {
    camera: MFP_CAMERA,
    bluetooth: MFP_BLUETOOTH,
    extra: MFP_EXTRA,
    location: MFP_LOCATION,
  };
}

/**
 * The full device signature block.
 * @param profile - Host facts.
 * @param seed - Stable install id.
 * @returns The deviceSignature object.
 */
function deviceBlockOf(profile: IDeviceProfile, seed: string): Record<string, unknown> {
  return {
    ...identityBlockOf(profile, seed),
    ...networkBlockOf(profile),
    ...hardwareBlockOf(),
  };
}

/**
 * Serialize one signature.
 * @param profile - Host facts.
 * @param seed - Stable install id.
 * @returns The raw JSON.
 */
function signatureOf(profile: IDeviceProfile, seed: string): string {
  const deviceSignature = deviceBlockOf(profile, seed);
  return JSON.stringify({ deviceSignature, ipAddress: profile.network.ipAddress });
}

/**
 * Whether a parsed value has the minimum the bank parses.
 * @param value - Parsed JSON.
 * @returns True when deviceSignature.system.androidId is non-empty text.
 */
function hasAndroidId(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.deviceSignature)) return false;
  const signature = value.deviceSignature;
  if (!isRecord(signature.system)) return false;
  const androidId = signature.system.androidId;
  return typeof androidId === 'string' && androidId.length > 0;
}

/**
 * Parse a stored signature.
 * @param value - Raw signature text.
 * @returns Parsed JSON, or a fixed failure.
 */
function parseOf(value: string): Procedure<unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return succeed(parsed);
  } catch {
    return fail(ScraperErrorTypes.Generic, INVALID);
  }
}

/**
 * Validate a stored signature without echoing it.
 * @param value - Raw signature text.
 * @returns Success, or a fixed Generic failure.
 */
function validate(value: string): Procedure<true> {
  if (value.length === 0 || value.length > MAX_SIGNATURE_CHARS) {
    return fail(ScraperErrorTypes.Generic, INVALID);
  }
  const parsed = parseOf(value);
  if (!isOk(parsed)) return parsed;
  return hasAndroidId(parsed.value) ? succeed(true) : fail(ScraperErrorTypes.Generic, INVALID);
}

/**
 * Generate a signature through the format interface.
 * @param profile - Host facts.
 * @param seed - Stable install id.
 * @returns The raw signature.
 */
function generate(profile: IDeviceProfile, seed: string): Procedure<string> {
  const value = signatureOf(profile, seed);
  return succeed(value);
}

/** The RiskMinder MFP format adapter. */
const RISK_MINDER_MFP_FORMAT: IDeviceSignatureFormat = {
  key: RISK_MINDER_MFP_KEY,
  generate,
  validate,
};

export default RISK_MINDER_MFP_FORMAT;
