import type { Page } from 'playwright';

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
export type ResultCondition = string | RegExp | ((opts?: { page?: Page }) => Promise<boolean>);
