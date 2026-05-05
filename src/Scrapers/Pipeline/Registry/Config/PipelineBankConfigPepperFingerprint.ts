/**
 * Pepper fingerprint + shared constants — split from
 * PipelineBankConfigPepper.ts to keep each file under 150 lines.
 * Zero bank knowledge leaves ApiDirectCall mediator; this file is
 * pure data (Rule #11 compliant).
 */

import type { IFingerprintConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import {
  APP_PERMISSIONS_LITERAL,
  CAPABILITIES_LITERAL,
  COLLECTOR_STATE_LITERAL,
  DEVICE_DETAILS_LITERAL,
  HW_AUTHENTICATORS_LITERAL,
} from './PipelineBankConfigPepperDevice.js';

/** App id passed as ?aid on every Transmit call. */
const AID = 'DIGITAL_BLL';
/** Locale passed as ?locale on every Transmit call. */
const LOCALE = 'en-US';
/** APK version — lands in data.params.Version_App (not X-TS-Client-Version). */
const APK_VERSION = '11.5.5';
/** SDK/tarsus version — both the X-TS-Client-Version header AND canonical. */
const TS_CLIENT_VERSION = '8.2.3 (10870);[1,2,3,6,7,8,10,11,12,14,28,19,27]';
/** SDK version string that lives in fingerprint.metadata.version. */
const SDK_VERSION_METADATA = '8.2.3 (10870)';

/** Fingerprint shape — hydrated with $ref: now / nowMs at bind-time. */
const PEPPER_FINGERPRINT: IFingerprintConfig = {
  shape: {
    metadata: {
      scheme_version: { $literal: 2 },
      physical_app_id: { $literal: 'com.pepper.ldb' },
      version: { $literal: SDK_VERSION_METADATA },
      timestamp: { $ref: 'now' },
    },
    content: {
      hw_authenticators: { $literal: HW_AUTHENTICATORS_LITERAL },
      device_details: {
        $literal: { ...DEVICE_DETAILS_LITERAL, master_key_generated: Date.now() },
      },
      app_permissions: { $literal: APP_PERMISSIONS_LITERAL },
      capabilities: { $literal: CAPABILITIES_LITERAL },
      collector_state: { $literal: COLLECTOR_STATE_LITERAL },
      local_enrollments: { $literal: {} },
    },
  },
};

/** Static headers attached to every Pepper auth call. */
const STATIC_HEADERS = {
  'X-TS-Client-Version': TS_CLIENT_VERSION,
  'User-Agent': 'okhttp/4.12.0',
};

export { AID, APK_VERSION, LOCALE, PEPPER_FINGERPRINT, STATIC_HEADERS, TS_CLIENT_VERSION };
export default PEPPER_FINGERPRINT;
