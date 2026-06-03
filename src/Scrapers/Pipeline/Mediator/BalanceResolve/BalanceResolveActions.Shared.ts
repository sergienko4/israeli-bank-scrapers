/**
 * BalanceResolveActions.Shared — sentinels + readers shared across
 * the BalanceResolveActions siblings (phase-2e-residue split).
 */

import type {
  IAccountIdentity,
  IActionContext,
  IBalanceExtracted,
  IBalanceFetchTemplate,
  IPipelineContext,
} from '../../Types/PipelineContext.js';

/** Empty extracted map sentinel for absent-state paths. */
const EMPTY_EXTRACTED: IBalanceExtracted = new Map();

/** Empty identity map sentinel — exposed so callers branch-free. */
const EMPTY_IDENTITIES: ReadonlyMap<string, IAccountIdentity> = new Map();

/** Empty response map sentinel keyed by bankAccountUniqueId. */
const EMPTY_RESPONSES: ReadonlyMap<string, unknown> = new Map();

/** Empty template sentinel — `url === ''` ⇒ no template emitted by SCRAPE.post. */
const EMPTY_TEMPLATE: IBalanceFetchTemplate = Object.freeze({ url: '', method: 'GET' });

/**
 * Read SCRAPE.post's emitted identities from scrape state.
 * @param input - Pipeline context.
 * @returns Identity map keyed by cardDisplayId.
 */
function readAccountIdentities(
  input: IPipelineContext | IActionContext,
): ReadonlyMap<string, IAccountIdentity> {
  const opt = (input as { readonly scrape?: IPipelineContext['scrape'] }).scrape;
  if (!opt?.has) return EMPTY_IDENTITIES;
  return opt.value.accountIdentities ?? EMPTY_IDENTITIES;
}

/**
 * Read SCRAPE.post's emitted balance fetch template.
 * @param input - Pipeline context.
 * @returns Fetch template.
 */
function readBalanceFetchTemplate(input: IPipelineContext | IActionContext): IBalanceFetchTemplate {
  const opt = (input as { readonly scrape?: IPipelineContext['scrape'] }).scrape;
  if (!opt?.has) return EMPTY_TEMPLATE;
  return opt.value.balanceFetchTemplate ?? EMPTY_TEMPLATE;
}

export {
  EMPTY_EXTRACTED,
  EMPTY_IDENTITIES,
  EMPTY_RESPONSES,
  EMPTY_TEMPLATE,
  readAccountIdentities,
  readBalanceFetchTemplate,
};
