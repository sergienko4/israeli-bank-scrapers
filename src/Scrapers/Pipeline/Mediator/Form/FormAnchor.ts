/**
 * FormAnchor — discover the form element wrapping a resolved input,
 * and rewrite SelectorCandidate values to constrain resolution within
 * that form.
 *
 * <p>Phase 12d split: this file is now a thin façade re-exporting the
 * three sub-modules under {@link ./Anchor/}.
 * @see ./Anchor/AnchorTypes.ts  — shared types + constants
 * @see ./Anchor/AnchorWalk.ts   — discoverFormAnchor (DOM ancestor walk)
 * @see ./Anchor/AnchorScope.ts  — scopeCandidate / scopeCandidates
 */

export { scopeCandidate, scopeCandidates } from './Anchor/AnchorScope.js';
export { discoverFormAnchor, type IFormAnchor } from './Anchor/AnchorWalk.js';
