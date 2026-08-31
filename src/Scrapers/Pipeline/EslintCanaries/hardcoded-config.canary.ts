/**
 * ESLint canary — hardcoded-config.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 DI: Config values must be injected vi
 */

// Canary: DI config literal — timeouts/dimensions must come from ctx.config
const options = { timeout: 5000 };

export { options };
