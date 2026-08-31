/**
 * ESLint canary — status-string.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 ARCHITECTURE: Use Enums or Constants
 */

// Canary: hardcoded status string — use Enums or Constants
function checkStatus(x: string): boolean {
  if (x === 'success') return true;
  return false;
}

export { checkStatus };
