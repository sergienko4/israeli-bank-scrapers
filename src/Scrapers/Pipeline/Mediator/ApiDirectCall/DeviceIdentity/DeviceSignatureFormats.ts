/**
 * Registered device-signature formats. A bank selects one by key; adding a
 * vendor format is a new adapter plus one entry here, never a Core change.
 */

import type { IDeviceSignatureFormat } from './DeviceIdentityTypes.js';
import RISK_MINDER_MFP_FORMAT from './Formats/RiskMinderMfp.js';

/** Format adapters by their stable key. */
const DEVICE_SIGNATURE_FORMATS: Readonly<Record<string, IDeviceSignatureFormat>> = {
  [RISK_MINDER_MFP_FORMAT.key]: RISK_MINDER_MFP_FORMAT,
};

export default DEVICE_SIGNATURE_FORMATS;
