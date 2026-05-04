/** Replacement label for PII fields in log output. */
export const PII_LABEL = '[PII_PROTECTED]';

/**
 * WellKnown sensitive key names — any log field whose key is in this set AND
 * whose string value is longer than 4 characters will be redacted to [PII_PROTECTED].
 * The 4-char exception preserves short display values (last4Digits, displayId)
 * while catching all long internal GUIDs (cardUniqueId, bankAccountUniqueID, etc.).
 */
export const WL_SENSITIVE_KEYS = new Set([
  // Internal card/account GUIDs used for API calls
  'cardUniqueId',
  'cardUniqueID',
  'bankAccountUniqueID',
  'bankAccountUniqueId',
  'accountId',
  'CardId',
  // Pipeline field-match result that carries the query ID
  'queryIdentifier',
]);

/** JSON paths to redact from pino log output (single source of truth =
 *  PiiRedactor.ts; this list is the Pino-side allow-list of paths to
 *  invoke the censor on). When an unknown path tail reaches the censor
 *  via wildcard, the redactor's default-deny rule applies. */
export const SENSITIVE_PATHS = [
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
  // Long-term auth context (otpLongTermToken + assertion ids) — fully redacted
  'otpLongTermToken',
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
  // Cookies / session tokens
  'cookie',
  'cookies',
  'setCookie',
];

/** Field names whose values are monetary amounts (masked to sign-only in logs). */
export const AMOUNT_KEYS = new Set(['balance', 'originalAmount', 'chargedAmount']);
