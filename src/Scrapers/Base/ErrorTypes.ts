/** Categorized error types returned by scrapers on failure. */
enum ScraperErrorTypes {
  TwoFactorRetrieverMissing = 'TWO_FACTOR_RETRIEVER_MISSING',
  InvalidOtp = 'INVALID_OTP',
  InvalidPassword = 'INVALID_PASSWORD',
  /** Supplied `phoneNumber` cannot be normalised to the bank's wire format. */
  InvalidPhoneNumber = 'INVALID_PHONE_NUMBER',
  ChangePassword = 'CHANGE_PASSWORD',
  Timeout = 'TIMEOUT',
  NetworkError = 'NETWORK_ERROR',
  AccountBlocked = 'ACCOUNT_BLOCKED',
  Generic = 'GENERIC',
  /**
   * Legacy generic error type — kept for backwards-compatibility.
   * @deprecated Use `Generic` instead.
   */
  General = 'GENERAL_ERROR',
  WafBlocked = 'WAF_BLOCKED',
}

export { ScraperErrorTypes };
export default ScraperErrorTypes;
