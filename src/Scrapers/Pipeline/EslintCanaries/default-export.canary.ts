/**
 * ESLint canary — default-export.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 ARCHITECTURE: Named exports only. Do
 */

// Canary: import-x/no-default-export — Pipeline must use named exports only
const value = 42;
export default value;
export { value };
