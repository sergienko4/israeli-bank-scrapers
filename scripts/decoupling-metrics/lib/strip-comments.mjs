/**
 * Comment stripping for decoupling metrics.
 *
 * <p>This lives apart from `graph.mjs` because it is the one piece of that
 * module the guardrail measurements need, and `graph.mjs` pulls in the
 * TypeScript compiler for its parsing. Sharing a module meant `guardrails.mjs`
 * inherited that dependency, so it could not be measured anywhere the compiler
 * was absent — which is how a CI job that installs no dependencies came to
 * report empty guardrail counts instead of failing. Keeping this helper
 * dependency-free lets the guardrails be measured from Node alone.
 */

const COMMENTS_RE = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g;

/**
 * Strips block and line comments so downstream regexes never match prose.
 *
 * <p>Without this, JSDoc phrasing such as "Best-effort: any throw is
 * swallowed" is counted as a real `: any` type annotation.
 *
 * @param text raw source text
 * @returns the same text with comment bodies removed
 */
export function stripComments(text) {
  return text.replace(COMMENTS_RE, '$1');
}
