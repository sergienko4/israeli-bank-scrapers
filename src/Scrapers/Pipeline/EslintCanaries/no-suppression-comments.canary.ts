// Canary fixture for the no-suppression-comments rule (eslint.config.mjs
// block #15). MUST contain at least one line matching the rule's `terms`
// array so the canary harness reports a non-zero error count.
// NOSONAR intentional fixture: must trigger the no-warning-comments rule
// biome-ignore lint: intentional fixture: must trigger no-warning-comments
export const noSuppressionCommentsCanary = true;
