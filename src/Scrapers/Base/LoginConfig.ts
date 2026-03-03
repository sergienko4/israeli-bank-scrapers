import { type Frame, type Page } from 'playwright';

import { type WaitUntilState } from '../../Common/Navigation';

/**
 * A single way to locate an element on the page.
 * Multiple candidates are tried in order until one resolves.
 */
export type SelectorCandidate =
  | { kind: 'css'; value: string } // #userCode, .login-input
  | { kind: 'placeholder'; value: string } // input[placeholder*="סיסמה"]
  | { kind: 'ariaLabel'; value: string } // [aria-label*="משתמש"]
  | { kind: 'name'; value: string } // input[name="password"]
  | { kind: 'xpath'; value: string }; // //button[contains(., "כניסה")]

/** One form field: which credential key to use + ordered selector candidates.
 *  `selectors` may be empty — wellKnownSelectors provides the fallback in that case. */
export interface FieldConfig {
  credentialKey: string;
  selectors: SelectorCandidate[];
}

/** OTP step config — DOM (selector-driven) or API (class override) */
export type OtpConfig =
  | {
      kind: 'dom';
      triggerSelectors?: SelectorCandidate[]; // optional "send code" button
      inputSelectors: SelectorCandidate[]; // where to type the OTP code
      submitSelectors: SelectorCandidate[]; // confirm button
      longTermTokenSupported: boolean;
    }
  | {
      kind: 'api'; // handled entirely in the scraper class (e.g. OneZero)
    };

/** A single login result condition: URL string, regex, or async page predicate */
type ResultCondition = string | RegExp | ((opts?: { page?: Page }) => Promise<boolean>);

/**
 * Map of login outcomes → conditions (same semantics as LoginOptions.possibleResults
 * but without importing the LoginResults enum, avoiding circular dependencies).
 */
export interface LoginPossibleResults {
  success: ResultCondition[];
  invalidPassword?: ResultCondition[];
  changePassword?: ResultCondition[];
  accountBlocked?: ResultCondition[];
  unknownError?: ResultCondition[];
}

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
