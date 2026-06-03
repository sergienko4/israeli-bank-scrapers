/**
 * Candidate-scoping and WK-concept lookup helpers for PipelineFieldResolver.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_CONCEPT_MAP, WK_LOGIN_FORM } from '../../Registry/WK/LoginWK.js';
import { none, some } from '../../Types/Option.js';
import { scopeCandidates } from '../Form/FormAnchor.js';
import type { IFieldCandidates, IWkLookup } from './PipelineFieldResolver.types.js';

/** Sentinel for no form scoping — avoids bare '' fallback. */
const NO_FORM_SCOPE = '';

/**
 * Apply form scoping to candidates if a form selector is present.
 * @param candidates - Raw candidates.
 * @param formSel - Form selector for scoping (empty string = no scope).
 * @returns Scoped or original candidates.
 */
function applyFormScope(
  candidates: readonly SelectorCandidate[],
  formSel: string,
): readonly SelectorCandidate[] {
  if (!formSel) return candidates;
  return scopeCandidates(formSel, [...candidates]);
}

/**
 * Look up well-known candidates for a field key.
 * @param fieldKey - Credential key.
 * @returns Slot label and candidate list (empty when no match).
 */
function resolveWkCandidates(fieldKey: string): IWkLookup {
  const wkSlot = WK_CONCEPT_MAP[fieldKey];
  if (wkSlot === undefined) return { slot: none(), wellKnown: [] };
  return { slot: some(wkSlot), wellKnown: WK_LOGIN_FORM[wkSlot] };
}

/**
 * Apply form scoping to bank + well-known candidate lists.
 * @param bank - Bank-specific candidates.
 * @param wellKnown - Well-known candidates.
 * @param formSelector - Optional form selector for scoping.
 * @returns Scoped candidate pair.
 */
function buildScopedCandidates(
  bank: readonly SelectorCandidate[],
  wellKnown: readonly SelectorCandidate[],
  formSelector?: string,
): IFieldCandidates {
  const scope = formSelector ?? NO_FORM_SCOPE;
  return { bank: applyFormScope(bank, scope), wk: applyFormScope(wellKnown, scope) };
}

export { buildScopedCandidates, resolveWkCandidates };
