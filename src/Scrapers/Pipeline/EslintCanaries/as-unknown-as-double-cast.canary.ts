/**
 * ESLint canary — `expr as unknown as T` double-cast at API boundary.
 *
 * The Phase H tests rule (eslint.config.mjs §8a) banned this pattern
 * in CrossValidation tests; this canary verifies the same selector
 * is now active in the Pipeline production scope (extended by the
 * same commit). Deliberate violation so verify.sh confirms the
 * guardrail fires.
 */

interface Payload {
  readonly id: string;
}

const raw: unknown = { id: 'fixture' };
const typed = raw as unknown as Payload;

export { typed };
