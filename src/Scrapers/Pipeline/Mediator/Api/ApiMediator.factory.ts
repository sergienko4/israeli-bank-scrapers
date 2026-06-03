/**
 * Top-level createApiMediator factory — wires deps + state into the shell.
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import type { IFetchStrategy } from '../../Strategy/Fetch/FetchStrategy.js';
import type { GraphQLFetchStrategy } from '../../Strategy/Fetch/GraphQLFetchStrategy.js';
import { assembleMediator } from './ApiMediator.builders.js';
import { makeInitialMediatorState } from './ApiMediator.state.js';
import type { IApiCallContext, IApiMediator, IApiMediatorDeps } from './ApiMediator.types.js';

/**
 * Build the per-call context shared by all apiPost/apiGet/apiQuery operations.
 * @param deps - Bundled collaborators.
 * @returns Per-call context wrapping fresh state + deps + bankHint.
 */
function buildCallContext(deps: IApiMediatorDeps): IApiCallContext {
  const state = makeInitialMediatorState();
  return { state, deps, bankHint: deps.bankHint };
}

/**
 * Create an ApiMediator instance (the Black Box).
 * Bearer state lives in a closed-over variable — callers have no direct access.
 * @param bankHint - Target bank (for WK lookups).
 * @param fetchStrategy - Low-level HTTP transport.
 * @param graphqlStrategy - GraphQL transport.
 * @returns ApiMediator implementation.
 */
function createApiMediator(
  bankHint: CompanyTypes,
  fetchStrategy: IFetchStrategy,
  graphqlStrategy: GraphQLFetchStrategy,
): IApiMediator {
  const deps: IApiMediatorDeps = { bankHint, fetchStrategy, graphqlStrategy };
  const ctx = buildCallContext(deps);
  const self = {} as IApiMediator;
  return assembleMediator(self, ctx);
}

export default createApiMediator;

export { createApiMediator };
