import type { ResultCondition } from '../LoginConfigTypes.js';

/**
 * Map of login outcomes → conditions (same semantics as ILoginOptions.possibleResults
 * but without importing the LoginResults enum, avoiding circular dependencies).
 */
export interface ILoginPossibleResults {
  success: ResultCondition[];
  invalidPassword?: ResultCondition[];
  changePassword?: ResultCondition[];
  accountBlocked?: ResultCondition[];
  unknownError?: ResultCondition[];
}
