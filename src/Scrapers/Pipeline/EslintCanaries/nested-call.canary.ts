/**
 * ESLint canary — nested-call.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 FORBIDDEN NESTED CALL: Assign the nes
 */

// Canary: nested CallExpression — assign to descriptive variable first
function outer(x: number): number {
  return x;
}
function inner(): number {
  return 1;
}
const result = outer(inner());

export { result };
