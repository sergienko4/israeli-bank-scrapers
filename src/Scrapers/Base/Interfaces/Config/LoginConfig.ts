import type { Frame, Page } from 'playwright-core';

import type { WaitUntilState } from '../../../../Common/Navigation.js';
import type { OtpConfig, SelectorCandidate } from '../../Config/LoginConfigTypes.js';
import type { LifecyclePromise } from '../CallbackTypes.js';
import type { ILoginPossibleResults } from '../LoginPossibleResults.js';
import type { IFieldConfig } from './FieldConfig.js';

/** Async page lifecycle callback that performs side effects without returning a value. */
type PageLifecycleCallback = (page: Page) => LifecyclePromise;

/** Nullable frame result from a pre-login action (matches Playwright API). */
type NullableFrameResult = Promise<Frame | undefined>;

/**
 * Login-flow capability flags — mirrors the legacy
 * `SCRAPER_CONFIGURATION.banks[*].loginSetup` shape so a
 * `GenericBankScraper` instance can declare its own flow shape
 * without being indexed in the legacy registry.
 */
export interface ILoginSetup {
  isApiOnly: boolean;
  hasOtpConfirm: boolean;
  hasOtpCode: boolean;
}

/**
 * Declarative login configuration — the "input" format.
 * Converted to ILoginOptions at runtime after selectors are resolved.
 * Does NOT replace ILoginOptions; both coexist.
 */
export interface ILoginConfig {
  loginUrl: string;
  fields: IFieldConfig[];
  submit: SelectorCandidate | SelectorCandidate[];
  possibleResults: ILoginPossibleResults;
  otp?: OtpConfig;
  checkReadiness?: PageLifecycleCallback;
  preAction?: (page: Page) => NullableFrameResult;
  postAction?: PageLifecycleCallback;
  waitUntil?: WaitUntilState;
  /**
   * Optional override for the login-flow capability flags. When set,
   * `GenericBankScraper.resolveLoginSetup()` returns these flags and
   * skips the legacy bank registry lookup — required for
   * pipeline-only banks (Discount, Beinleumi, …) referenced from
   * synthetic test scrapers (`ConcreteGenericScraper`).
   */
  loginSetup?: ILoginSetup;
}
