// Canary fixture for the prettier-ignore ban (eslint.config.mjs
// block #3 + block #15 `no-warning-comments` terms list). MUST contain
// at least one line matching the rule's `terms` array so the canary
// harness reports a non-zero error count.
//
// Why this canary exists (phase-2 C13-C21 campaign): the directive
// below was being used across Pipeline code to defeat prettier's
// natural wrap of object literals / discriminated unions / arg lists,
// letting authors keep fn bodies under cap without doing the proper
// refactor (extract helper / spread-builders / accept the wrap). Per
// `comments-in-code-guidlines.md` §4 + `eslint-rules-guidlines.md` §3
// it belongs in the same suppression family as the other terms.
//
// If this canary stops failing, restore the term in BOTH terms arrays.

// prettier-ignore
export const noPrettierIgnoreCanary = true;
