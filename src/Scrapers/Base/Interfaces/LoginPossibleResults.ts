import type { ResultCondition } from '../LoginConfigTypes.js';

/**
 * Map of login outcomes → conditions (same semantics as LoginOptions.possibleResults
 * but without importing the LoginResults enum, avoiding circular dependencies).
 */
export interface LoginPossibleResults {
  success: ResultCondition[];
  invalidPassword?: ResultCondition[];
  changePassword?: ResultCondition[];
  accountBlocked?: ResultCondition[];
  unknownError?: ResultCondition[];
}
