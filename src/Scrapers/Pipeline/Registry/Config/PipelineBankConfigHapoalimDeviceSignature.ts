/**
 * Hapoalim app device signature — the RiskMinder `rmDeviceID` value the
 * official app sends as `mfp`, captured from a live enrolment.
 *
 * <p>It is a device-attestation literal, not a user secret: the same
 * captured value the Pepper config ships for its device fingerprint.
 * A deployment that needs its own device identity overrides it in the
 * config secrets; the value never reaches logs or evidence.</p>
 */
const HAPOALIM_DEVICE_SIGNATURE =
  '{"deviceSignature":{"collector":"Android","collectorVersion":"8.2.4.1","' +
  'system":{"platform":"Android34","androidId":"da887549c01e2664","osVersio' +
  'n":"14","deviceName":"emu64xa","model":"sdk_gphone64_x86_64","board":"go' +
  'ldfish_x86_64","brand":"google","host":"r-d3d21742fc70d910-jcvw","id":"U' +
  'E1A.230829.050","type":"userdebug","user":"android-build","cpuAbi":"x86_' +
  '64","cpuAbi2":"arm64-v8a","hardware":"ranchu","manufacturer":"Google","s' +
  'erial":"unknown","tags":"dev-keys","locale":"English (United States)","r' +
  'adio":"1.0.0.0","processName":"com.ideomobile.hapoalim","systemName":"An' +
  'droid OS","jailBroken":false,"timeZone":"Asia\\/Jerusalem","debuggerAttac' +
  'hed":true,"totalDiskSpace":"9928","totalMemory":1974,"numberOfProcessors' +
  '":1},"screen":{"displayId":"sdk_gphone64_x86_64-userdebug 14 UE1A.230829' +
  '.050 12077443 dev-keys","width":"1080","height":"2209","orientation":"1"' +
  '},"browser":{"userAgent":"Dalvik 2.1.0 (Linux; U; Android 14; sdk_gphone' +
  '64_x86_64 Build UE1A.230829.050)"},"wifi":{"connected":true,"macAddress"' +
  ':"02:00:00:00:00:00","ipAddress":"10.0.2.16","netmaskAddress":"0.0.0.0",' +
  '"gatewayAddress":"10.0.2.2","broadcastAddress":"255.255.255.255","userEn' +
  'abled":true},"telephony":{"imeiNumber":null,"carrierIsoCountryCode":"us"' +
  ',"carrierName":"T-Mobile","carrierMobileCountryCode":null,"simOperatorNa' +
  'me":"T-Mobile","carrierMobileNetworkCode":"260","networkType":"GPRS","ph' +
  'oneType":"GSM","simIsoCountryCode":"us","isRoamingNetwork":false,"cellIp' +
  'Address":null,"simSerialNumber":null,"subscriberId":null},"camera":{"num' +
  'berOfCameras":null,"rearCamera":null,"frontCamera":"__SDK_DISABLED__","a' +
  'utoFocus":null,"flash":null,"rearCameraSupportedSizes":null,"rearCameraS' +
  'upportedFormats":null,"frontCameraSupportedSizes":"__SDK_DISABLED__","fr' +
  'ontCameraSupportedFormats":"__SDK_DISABLED__"},"bluetooth":{"macAddress"' +
  ':null,"supported":null},"extra":{"account":null,"securityPolicy":true},"' +
  'location":{"latitude":null,"longitude":null}},"ipAddress":"10.0.2.16"}';

export default HAPOALIM_DEVICE_SIGNATURE;
