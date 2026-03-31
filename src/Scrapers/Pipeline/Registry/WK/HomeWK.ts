/**
 * Home phase WK constants — login entry, reveal, form check.
 * Isolated: NO imports from Login, Dashboard, or Scrape WK.
 */

/** Home phase WK — entry points, reveal toggles, form readiness checks. */
export const WK_HOME = {
  ENTRY: [
    { kind: 'textContent', value: 'כניסה לחשבון' },
    { kind: 'textContent', value: 'כניסה לאיזור האישי' },
    { kind: 'textContent', value: 'כניסה והרשמה' },
    { kind: 'textContent', value: 'התחברות' },
    { kind: 'textContent', value: 'כניסה' },
    { kind: 'ariaLabel', value: 'כניסה לחשבון' },
  ],
  REVEAL: [
    { kind: 'textContent', value: 'לקוחות פרטיים' },
    { kind: 'textContent', value: 'אזור אישי' },
    { kind: 'textContent', value: 'כניסה עם סיסמה' },
    { kind: 'textContent', value: 'כניסה לחשבון' },
    { kind: 'textContent', value: 'כניסה רגילה' },
    { kind: 'textContent', value: 'כניסה בסיסמה קבועה' },
    { kind: 'textContent', value: 'כניסה עם שם משתמש' },
    { kind: 'textContent', value: 'סיסמה קבועה' },
    { kind: 'ariaLabel', value: 'כניסה עם סיסמה קבועה' },
    { kind: 'ariaLabel', value: 'כניסה רגילה' },
  ],
  FIELD_READY: [
    { kind: 'placeholder', value: 'תעודת זהות' },
    { kind: 'placeholder', value: 'מספר זהות' },
    { kind: 'placeholder', value: 'ת.ז' },
    { kind: 'placeholder', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'קוד משתמש' },
    { kind: 'placeholder', value: 'סיסמה' },
    { kind: 'placeholder', value: 'קוד סודי' },
    { kind: 'labelText', value: 'תעודת זהות' },
    { kind: 'labelText', value: 'שם משתמש' },
    { kind: 'labelText', value: 'סיסמה' },
  ],
  FORM_CHECK: [
    { kind: 'labelText', value: 'תעודת זהות' },
    { kind: 'labelText', value: 'מספר זהות' },
    { kind: 'labelText', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'תעודת זהות' },
    { kind: 'placeholder', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'ת.ז' },
    { kind: 'name', value: 'id' },
    { kind: 'name', value: 'username' },
  ],
} as const;
export default WK_HOME;
