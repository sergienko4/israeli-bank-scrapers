import type { Page } from 'playwright';

/**
 * A single way to locate an element on the page.
 * Multiple candidates are tried in order until one resolves.
 */
export type SelectorCandidate =
  | { kind: 'labelText'; value: string } // find <label> by text, use for= attr → input
  | { kind: 'textContent'; value: string } // find visible text, walk up DOM to interactive ancestor
  | { kind: 'css'; value: string } // #userCode, .login-input
  | { kind: 'placeholder'; value: string } // input[placeholder*="סיסמה"]
  | { kind: 'ariaLabel'; value: string } // input[aria-label*="משתמש"]
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

/** A single login result condition: URL string, regex, or sync/async page predicate */
type ResultConditionFn = (opts?: { page?: Page }) => boolean | Promise<boolean>;
export type ResultCondition = string | RegExp | ResultConditionFn;
