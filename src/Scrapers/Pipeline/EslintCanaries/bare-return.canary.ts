/**
 * ESLint canary — bare-return.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 LOGIC: Forbidden return value. Functi
 */

// Canary: ReturnStatement[argument=null] — bare return; must be caught
const earlyExit = () => {
  return;
};

export { earlyExit };
