/**
 * Type-only companion for PipelineBankConfig — interfaces + narrow aliases.
 * Keeps the main file under the max-lines ceiling while preserving
 * Rule #15 named-alias discipline.
 */

/** Bank website URL string. */
type BankUrl = string;
/** Whether a bank capability is active. */
type IsEnabled = boolean;
/** Company-specific code for proxy auth. */
type CompanyCode = string;

/** Parametric proxy query params — date tokens resolved at runtime. */
export interface IProxyParams {
  /** Dashboard query params (e.g. { billingDate: 'YYYY-MM-01' }). */
  readonly dashboard?: Readonly<Record<string, string>>;
  /** Transaction query params (e.g. { month: 'MM', year: 'YYYY' }). */
  readonly transactions?: Readonly<Record<string, string>>;
}

/** Proxy auth params — injected via .withProxyAuth() for proxy-based banks. */
export interface IProxyAuth {
  /** Bank-specific company code (e.g. '77' for Amex, '11' for Isracard). */
  readonly companyCode: CompanyCode;
  /** Parametric query params for proxy API calls — date tokens resolved at runtime. */
  readonly params?: IProxyParams;
}

/** OTP config — per-bank runtime flag. Trigger/fill controlled by builder chain. */
export interface IOtpBankConfig {
  /** Whether this bank requires OTP after login. */
  readonly enabled: IsEnabled;
  /**
   * Whether OTP is MANDATORY for every login.
   *   true  — always prompts (Beinleumi/Massad/OtsarHahayal/Pagi).
   *   false — may skip for remembered devices (Hapoalim).
   * Default when omitted: true.
   */
  readonly required?: IsEnabled;
}

/** Generic auth-path keys — per-bank subsets plug into `paths` below. */
export type AuthPathKey =
  | 'identity.deviceToken'
  | 'identity.otpPrepare'
  | 'identity.otpVerify'
  | 'identity.getIdToken'
  | 'identity.sessionToken'
  | 'auth.bind'
  | 'auth.assert'
  | 'auth.logout';

/** Headless-strategy URL block — populates ctx.apiMediator at build time. */
export interface IHeadlessUrlsConfig {
  readonly identityBase: BankUrl;
  readonly graphql: BankUrl;
  /** Per-bank auth-path map — only the keys the bank actually uses. */
  readonly paths: Readonly<Partial<Record<AuthPathKey, BankUrl>>>;
  /** Static Authorization header installed before login (e.g. Transmit TSToken). */
  readonly staticAuth?: BankUrl;
}

/** Pipeline bank config — HOME phase URL + optional proxy auth. */
export interface IPipelineBankConfig {
  /** Official website URL — HOME phase navigates here. */
  readonly urls: {
    readonly base: BankUrl;
  };
  /** Proxy auth params — for banks using ProxyRequestHandler login. */
  readonly auth?: IProxyAuth;
  /** Fallback transaction API path — used when network discovery finds nothing. */
  readonly transactionsPath?: BankUrl;
  /** OTP config — per-bank control over trigger + fill behavior. */
  readonly otp?: IOtpBankConfig;
  /** Headless-strategy URLs — populated for API-native banks (no browser). */
  readonly headless?: IHeadlessUrlsConfig;
}
