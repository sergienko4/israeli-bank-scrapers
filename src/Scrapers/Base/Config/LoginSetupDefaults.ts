/**
 * Runtime defaults for `ILoginSetup` capability flags.
 *
 * Centralized so `GenericBankScraper` and every selector-fallback /
 * mocked-e2e test can refer to the SAME object without duplicating the
 * literal `{ isApiOnly:false, hasOtpConfirm:false, hasOtpCode:false }`
 * across multiple files.
 *
 * Mirrors the legacy registry's `SIMPLE_LOGIN` constant — both describe
 * a standard non-OTP, browser-driven login flow. Defined here (rather
 * than imported from `Scrapers/Registry/Config/`) to avoid an
 * upstream-base → downstream-registry dependency inversion.
 */
import type { ILoginSetup } from '../Interfaces/Config/LoginConfig.js';

/**
 * Standard non-OTP login-setup flags. Use as the fallback when an
 * `ILoginConfig` does not declare `loginSetup` of its own.
 *
 * `as const satisfies ILoginSetup` — readonly literal narrowing
 * guarantees structural conformance to {@link ILoginSetup} while
 * preserving exact literal types so accidental mutation is caught.
 */
export const LOGIN_SETUP_DEFAULT = {
  isApiOnly: false,
  hasOtpConfirm: false,
  hasOtpCode: false,
} as const satisfies ILoginSetup;

/**
 * OTP-enabled login-setup flags (both confirm-button and code-entry
 * supported). Used by the OTP-detection mocked-e2e tests as the
 * primary capability set, with overrides for the no-OTP regression
 * case.
 *
 * `as const satisfies ILoginSetup` — see {@link LOGIN_SETUP_DEFAULT}.
 */
export const LOGIN_SETUP_OTP_ENABLED = {
  isApiOnly: false,
  hasOtpConfirm: true,
  hasOtpCode: true,
} as const satisfies ILoginSetup;
