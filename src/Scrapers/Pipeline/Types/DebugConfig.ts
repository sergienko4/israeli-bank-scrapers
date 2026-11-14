/** JSON paths to redact from pino log output (single source of truth =
 *  PiiRedactor.ts; this list is the Pino-side allow-list of paths to
 *  invoke the censor on). When an unknown path tail reaches the censor
 *  via wildcard, the redactor's default-deny rule applies. */
const SENSITIVE_PATHS = [
  // Credentials
  'password',
  'credentials.password',
  'token',
  'auth.token',
  'auth.calConnectToken',
  'secret',
  'otp',
  'otpCode',
  'id',
  'credentials.id',
  'card6Digits',
  'credentials.card6Digits',
  'credentials.num',
  'authorization',
  // Internal card GUIDs (WL_SENSITIVE_KEYS that appear in top-level log objects)
  'cardUniqueId',
  'cardUniqueID',
  'bankAccountUniqueID',
  'bankAccountUniqueId',
  'accountId',
  'CardId',
  'queryIdentifier',
  // Account number (last-4 shown via censor, full number hidden)
  'accountNumber',
  // Monetary amounts (sign-only via censor)
  'balance',
  'chargedAmount',
  'originalAmount',
  'eventAmount',
  // Names — redacted to '<name:N>' length tag
  'firstName',
  'lastName',
  'fullName',
  'customerName',
  'name',
  // Israeli national ID
  'israeliId',
  'MisparZihuy',
  // Phone numbers — redacted to '***<last4>'
  'phone',
  'phoneNumber',
  'mobile',
  'email',
  // Transaction merchant / description — redacted to '<merchant:N>'
  'description',
  'merchant',
  'payee',
  // Long-term auth context (otpLongTermToken + assertion ids) — fully redacted.
  // `longTermToken` is the onAuthFlowComplete payload key and
  // `persistentOtpToken` is the public result field; the same durable
  // credential travels under all three names, and pino's redact.paths is an
  // exact-name match, so every alias has to be listed (issue #576).
  'otpLongTermToken',
  'longTermToken',
  'persistentOtpToken',
  // Hapoalim device identity: the per-user seed is a long-lived credential
  // inside `otpLongTermToken`; the signature is the raw `mfp` payload.
  'deviceSeed',
  'credentials.deviceSeed',
  'deviceSignature',
  'credentials.deviceSignature',
  'mfp',
  'credentials.mfp',
  'idToken',
  'otpToken',
  'smsAssertionId',
  'pwdAssertionId',
  'otpContext',
  'deviceToken',
  'sessionId',
  'deviceId',
  'challenge',
  'Sisma',
  // Durable device-auth options: the opaque state embeds a bearer token and a
  // device private key, so both option names are redacted wherever they land.
  'persistentAuthState',
  'onPersistentAuthStateUpdate',
  // Cookies / session tokens
  'cookie',
  'cookies',
  'setCookie',
];

export default SENSITIVE_PATHS;
