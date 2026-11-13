/**
 * Neutral RiskMinder MFP blocks — the vendor fields a Node host has no
 * hardware for. Data only; the format adapter spreads them into its signature.
 */

/** Screen values a neutral app install reports. */
const MFP_SCREEN = { width: '1080', height: '2209', orientation: '1' } as const;

/** A server has no SIM, camera, Bluetooth radio or location. */
const MFP_TELEPHONY = {
  imeiNumber: null,
  carrierIsoCountryCode: 'il',
  carrierName: 'unknown',
  carrierMobileCountryCode: null,
  simOperatorName: 'unknown',
  carrierMobileNetworkCode: '0',
  networkType: 'GPRS',
  phoneType: 'GSM',
  simIsoCountryCode: 'il',
  isRoamingNetwork: false,
  cellIpAddress: null,
  simSerialNumber: null,
  subscriberId: null,
} as const;

/** Camera block of a host with no camera APIs. */
const MFP_CAMERA = {
  numberOfCameras: null,
  rearCamera: null,
  frontCamera: null,
  autoFocus: null,
  flash: null,
  rearCameraSupportedSizes: null,
  rearCameraSupportedFormats: null,
  frontCameraSupportedSizes: null,
  frontCameraSupportedFormats: null,
} as const;

const MFP_BLUETOOTH = { macAddress: null, supported: null } as const;
const MFP_EXTRA = { account: null, securityPolicy: true } as const;
const MFP_LOCATION = { latitude: null, longitude: null } as const;

/** System fields a Node host reports verbatim, with no Android hardware. */
const MFP_SYSTEM_STATIC = {
  user: 'node',
  cpuAbi2: '',
  serial: 'unknown',
  tags: 'release-keys',
  radio: '1.0.0.0',
  processName: 'node',
  systemName: 'Android OS',
  jailBroken: false,
  debuggerAttached: false,
  totalDiskSpace: '0',
  brand: 'node',
  manufacturer: 'node',
} as const;

export {
  MFP_BLUETOOTH,
  MFP_CAMERA,
  MFP_EXTRA,
  MFP_LOCATION,
  MFP_SCREEN,
  MFP_SYSTEM_STATIC,
  MFP_TELEPHONY,
};
