import type { Frame, Page } from 'playwright';

import type { WaitUntilState } from '../../../Common/Navigation.js';
import type { OtpConfig, SelectorCandidate } from '../LoginConfigTypes.js';
import type { LifecyclePromise } from './CallbackTypes.js';
import type { IFieldConfig } from './FieldConfig.js';
import type { ILoginPossibleResults } from './LoginPossibleResults.js';

/** Async page lifecycle callback that performs side effects without returning a value. */
type PageLifecycleCallback = (page: Page) => LifecyclePromise;

/** Nullable frame result from a pre-login action (matches Playwright API). */
type NullableFrameResult = Promise<Frame | undefined>;

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
}
