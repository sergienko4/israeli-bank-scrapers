/**
 * ESLint canary — as-never.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 TEST INTEGRITY: Do not use 'as never'
 */

// Canary: TSAsExpression > TSNeverKeyword — as never/as any banned in tests
const mock = {} as never;

export { mock };
