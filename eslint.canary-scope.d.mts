/**
 * Type surface for the shared SonarJS parity scope.
 *
 * Hand-written because the module itself is `.mjs` (ESLint's flat config
 * must import it at runtime without a build step) while
 * `src/Tests/Tools/LintValidator.ts` needs types for the same values.
 */

export declare const SONAR_PARITY_IGNORE_PREFIXES: readonly string[];
export declare const SONAR_PARITY_IGNORE_GLOBS: readonly string[];
export declare const SKIP_ALLOWLIST_FILES: readonly string[];
