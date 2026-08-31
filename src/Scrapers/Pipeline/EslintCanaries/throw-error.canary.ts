/**
 * ESLint canary — throw-error.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: Do not use 'throw new Error()'. Use a cu
 */

// Canary: ThrowStatement — Pipeline code must use Result Pattern, not throw
function crasher(): boolean {
  throw new Error('should use fail()');
}

export { crasher };
