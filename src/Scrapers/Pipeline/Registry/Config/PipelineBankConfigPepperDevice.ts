/**
 * Pepper device-details + permissions literal data — split from
 * PipelineBankConfigPepperFingerprint.ts to keep files under 150 lines.
 */

/**
 * Transmit device-details fingerprint (20 fields). Values captured
 * 2026-04-23 from Pepper 11.5.5 live flow. master_key_generated is
 * hydrated at bind-time via $ref: 'nowMs'.
 */
const DEVICE_DETAILS_LITERAL = {
  hw_type: 'Phone',
  tampered: true,
  sim_operator: '310260',
  roaming: false,
  device_model: 'Google/sdk_gphone64_x86_64',
  os_version: '13',
  jailbroken: true,
  security_patch: '2024-03-01',
  sim_operator_name: 'T-Mobile',
  frontal_camera: false,
  device_name: 'e71c2b2f5a0cbd94',
  has_hw_security: false,
  screen_lock: false,
  os_type: 'Android',
  boot_loader: 'unknown',
  base_os: '',
  logged_users: 0,
  persistence_mode: 'false',
  last_reboot: 85993,
  tz: 'GMT',
  sflags: -3,
  supported_abis: ['x86_64'],
};

/**
 * Build the granted-permission entry for one permission name.
 * @param name - Permission identifier.
 * @returns Granted-permission entry.
 */
function toGrantedPermission(name: string): { name: string; granted: boolean } {
  return { name, granted: true };
}

/** App permissions — 23 entries captured 2026-04-23. */
const APP_PERMISSIONS_LITERAL = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'com.google.android.c2dm.permission.RECEIVE',
  'com.google.android.gms.permission.AD_ID',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.DOWNLOAD_WITHOUT_NOTIFICATION',
  'android.permission.ACCESS_ADSERVICES_ATTRIBUTION',
  'android.permission.USE_FINGERPRINT',
  'android.permission.USE_BIOMETRIC',
  'android.permission.READ_PROFILE',
  'android.permission.ACCESS_ADSERVICES_AD_ID',
  'android.permission.FOREGROUND_SERVICE',
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
  'com.google.android.providers.gsf.permission.READ_GSERVICES',
  'com.pepper.ldb.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
  'android.permission.NFC',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.ACCESS_NOTIFICATION_POLICY',
].map(toGrantedPermission);

/** Capabilities block — host SDK snapshot. */
const CAPABILITIES_LITERAL = {
  fido2_user_verifying_platform_authenticator_available: false,
  audio_acquisition_supported: true,
  finger_print_supported: false,
  image_acquisition_supported: true,
  persistent_keys_supported: true,
  face_id_key_bio_protection_supported: false,
  fido2_client_present: true,
  dyadic_present: false,
  installed_plugins: [],
  host_provided_features: '19',
};

/** Collector state block — all sub-collectors. */
const COLLECTOR_STATE_LITERAL = {
  accounts: 'active',
  devicedetails: 'active',
  contacts: 'active',
  owner: 'active',
  locationcountry: 'active',
  bluetooth: 'active',
  externalsdkdetails: 'active',
  hwauthenticators: 'active',
  capabilities: 'active',
  largedata: 'active',
  localenrollments: 'active',
  devicefingerprint: 'active',
  apppermissions: 'active',
  software: 'disabled',
  location: 'disabled',
};

/** Hardware-authenticators block — supported feature matrix. */
const HW_AUTHENTICATORS_LITERAL = {
  device_biometrics: {
    supported: true,
    user_registered: false,
    possible_types: ['fingerprint'],
  },
  fingerprint: { supported: false, user_registered: false },
  face_id: { supported: false, user_registered: false },
};

export {
  APP_PERMISSIONS_LITERAL,
  CAPABILITIES_LITERAL,
  COLLECTOR_STATE_LITERAL,
  DEVICE_DETAILS_LITERAL,
  HW_AUTHENTICATORS_LITERAL,
};
