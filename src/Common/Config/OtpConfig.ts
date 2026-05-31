/** Delay for OTP input field animation to complete (ms). */
export const OTP_ANIMATION_DELAY_MS = 800;

/** Delay before verifying OTP acceptance after submission (ms). */
export const OTP_VERIFY_DELAY_MS = 5000;

/** Delay after triggering OTP SMS delivery (ms). */
export const OTP_TRIGGER_DELAY_MS = 2000;

/** Delay between individual key presses when typing OTP code (ms). */
export const OTP_CHAR_INPUT_DELAY_MS = 80;

/** CSS selectors to try when locating the OTP code input field. */
export const OTP_FILL_INPUT_SELECTORS = [
  '#codeinput',
  'input[placeholder*="סיסמה"]:not([id="password"])',
  'input[placeholder*="קוד חד פעמי"]',
  'input[placeholder*="קוד SMS"]',
  'input[placeholder*="קוד אימות"]',
  'input[placeholder*="הזן קוד"]',
  'input[placeholder*="one-time"]',
  'input[type="tel"]',
  '[name="otpCode"]',
];
