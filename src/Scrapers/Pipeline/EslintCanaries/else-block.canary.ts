/**
 * ESLint canary — else-block.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 'else' blocks are disallowed. Use ear
 */

// Canary: IfStatement[alternate] — use guard clauses, not else
function withElse(x: boolean): string {
  if (x) {
    return 'yes';
  } else {
    return 'no';
  }
}

export { withElse };
