/**
 * Pure decision logic for `assert-numeric-canaries.cjs`.
 *
 * Kept separate from the harness so it can be exercised directly by tests
 * without loading ESLint, and so the rule that decides whether a canary is
 * anchored is readable on its own.
 */

/** A resolved rule with no usable cap. */
const NO_CAP = { found: false, max: 0, options: {} };

/**
 * Cap and options from a resolved flat-config rule value.
 *
 * Returns a `found` flag rather than null, so every caller and every test can
 * name the capless case without a null return.
 * @param value - Rule value, `['error', 150]` or `['error', { max: 150 }]`.
 * @returns `{ found, max, options }`; `found` is false when off or capless.
 */
const capOf = value => {
  if (!Array.isArray(value) || value[0] === 'off' || value[0] === 0) return NO_CAP;
  const options = value[1];
  if (typeof options === 'number') return { found: true, max: options, options: { max: options } };
  if (options && typeof options.max === 'number') return { found: true, max: options.max, options };
  return NO_CAP;
};

/**
 * The harness verdict for one canary.
 *
 * A canary that declares a numeric rule which resolves to no cap is a failure,
 * not a skip: either the declaration is wrong or the rule has been switched
 * off for that path. Skipping it silently would let the harness report success
 * having measured nothing — the vacuous pass the canary suite exists to catch.
 * @param cap - The canary's own scoped cap, as returned by `capOf`.
 * @param stillRed - Whether the rule still reports at `cap + 1`.
 * @returns `'unarmed'`, `'unanchored'`, or `'ok'`.
 */
const verdict = (cap, stillRed) => {
  if (!cap.found) return 'unarmed';
  return stillRed ? 'unanchored' : 'ok';
};

module.exports = { NO_CAP, capOf, verdict };
