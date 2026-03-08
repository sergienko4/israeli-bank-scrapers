import type { Frame, Page } from 'playwright';

import type { WaitUntilState } from '../../../Common/Navigation.js';
import type { OtpConfig, SelectorCandidate } from '../LoginConfigTypes.js';
import type { FieldConfig } from './FieldConfig.js';
import type { LoginPossibleResults } from './LoginPossibleResults.js';

/**
 * Declarative login configuration — the "input" format.
 * Converted to LoginOptions at runtime after selectors are resolved.
 * Does NOT replace LoginOptions; both coexist.
 */
export interface LoginConfig {
  loginUrl: string;
  fields: FieldConfig[];
  submit: SelectorCandidate | SelectorCandidate[];
  possibleResults: LoginPossibleResults;
  otp?: OtpConfig;
  checkReadiness?: (page: Page) => Promise<void>;
  preAction?: (page: Page) => Promise<Frame | undefined>;
  postAction?: (page: Page) => Promise<void>;
  waitUntil?: WaitUntilState;
}
