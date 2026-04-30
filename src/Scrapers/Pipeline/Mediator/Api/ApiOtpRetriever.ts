/**
 * Generic OTP-retriever helpers — shared across every headless bank.
 * Resolves the caller-supplied OTP callback (from ScraperOptions or
 * credentials) and binds the phone hint so downstream orchestration
 * can invoke it parameter-free.
 * Zero bank-name literals — all logic is bank-agnostic.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';

/** Phone number in international format. */
type PhoneNumberStr = string;
/** OTP code entered by the user. */
type OtpCodeStr = string;

/** Signature of a hint-accepting OTP retriever. */
export type OtpRetrieverFn = (phoneHint: PhoneNumberStr) => Promise<OtpCodeStr>;

/** Credentials shape the picker inspects — just the retriever slot. */
export interface IOtpCredsView {
  readonly otpCodeRetriever?: OtpRetrieverFn;
}

/**
 * Resolve the OTP retriever — prefer ScraperOptions, fall back to creds.
 * @param ctx - Pipeline context (ScraperOptions source).
 * @param creds - Bank credentials with an optional retriever slot.
 * @returns Retriever function, or false when neither source provides one.
 */
export function pickRetriever(ctx: IPipelineContext, creds: IOtpCredsView): OtpRetrieverFn | false {
  const optionsRetriever = ctx.options.otpCodeRetriever;
  const credsRetriever = creds.otpCodeRetriever;
  return optionsRetriever ?? credsRetriever ?? false;
}

/**
 * Bind a phone-hint to a hint-accepting retriever.
 * @param retrieve - Retriever that expects a phone hint.
 * @param phoneNumber - Phone number hint to pass through.
 * @returns Parameterless retriever closed over the phone hint.
 */
export function bindPhoneHint(
  retrieve: OtpRetrieverFn,
  phoneNumber: PhoneNumberStr,
): () => Promise<OtpCodeStr> {
  /**
   * Invoke the retriever with the closed-over phone hint.
   * @returns OTP code entered by the user.
   */
  const bound = (): Promise<OtpCodeStr> => retrieve(phoneNumber);
  return bound;
}
