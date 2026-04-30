/**
 * PRE-LOGIN phase WK constants — reveal toggles, login method selectors.
 * 100% independent from HomeWK. Each phase owns its own WK.
 * These are BUTTONS/TABS that reveal a hidden login form — NOT navigation links.
 */

/** PRE-LOGIN WK — elements that toggle login form visibility. */
export const WK_PRELOGIN = {
  /** Form gate — universal check that the login form is rendered. */
  FORM_GATE: [
    { kind: 'xpath', value: '//input[@type="password"]' },
    { kind: 'xpath', value: '//input[contains(@class,"password")]' },
  ],
  /** Submit gate — visible submit button proves the form is interactable. */
  SUBMIT_GATE: [
    { kind: 'xpath', value: '//button[@type="submit"]' },
    { kind: 'xpath', value: '//input[@type="submit"]' },
    {
      kind: 'xpath',
      value: '//button[contains(@ng-click,"login") or contains(@ng-click,"submit")]',
    },
  ],
  /** Reveal toggles — buttons/tabs that show the login form or switch login method. */
  REVEAL: [
    // clickableText — innermost element (tabs, buttons inside popups)
    { kind: 'clickableText', value: 'כניסה עם שם משתמש' },
    { kind: 'clickableText', value: 'כניסה עם סיסמה קבועה' },
    { kind: 'clickableText', value: 'כניסה עם סיסמה' },
    { kind: 'clickableText', value: 'כניסה רגילה' },
    { kind: 'clickableText', value: 'כניסה בסיסמה קבועה' },
    { kind: 'clickableText', value: 'כניסה באמצעות סיסמה קבועה' },
    { kind: 'clickableText', value: 'סיסמה קבועה' },
    // ariaLabel — role-aware (tab, button, link)
    { kind: 'ariaLabel', value: 'כניסה עם שם משתמש' },
    { kind: 'ariaLabel', value: 'כניסה עם סיסמה קבועה' },
    { kind: 'ariaLabel', value: 'או כניסה עם סיסמה קבועה' },
    { kind: 'ariaLabel', value: 'כניסה רגילה' },
    // textContent — walk-up fallback (full pages, nav links)
    { kind: 'textContent', value: 'לקוחות פרטיים' },
    { kind: 'textContent', value: 'אזור אישי' },
  ],
} as const;

export default WK_PRELOGIN;
