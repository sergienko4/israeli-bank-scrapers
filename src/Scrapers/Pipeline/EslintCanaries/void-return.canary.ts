/**
 * ESLint canary — void-return.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 ARCHITECTURE: 'void' is forbidden. Ev
 */

// Canary: void return type ban — functions must return meaningful values
function doNothing(): void {
  console.log('side effect');
}

export { doNothing };
