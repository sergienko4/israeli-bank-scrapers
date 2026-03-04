export enum ScraperErrorTypes {
  TwoFactorRetrieverMissing = 'TWO_FACTOR_RETRIEVER_MISSING',
  InvalidOtp = 'INVALID_OTP',
  InvalidPassword = 'INVALID_PASSWORD',
  ChangePassword = 'CHANGE_PASSWORD',
  Timeout = 'TIMEOUT',
  AccountBlocked = 'ACCOUNT_BLOCKED',
  Generic = 'GENERIC',
  /** @deprecated Use `Generic` instead. Kept for backwards-compatibility. */
  General = 'GENERAL_ERROR',
  WafBlocked = 'WAF_BLOCKED',
}
