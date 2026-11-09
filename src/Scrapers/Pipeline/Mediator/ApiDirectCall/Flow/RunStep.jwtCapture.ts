/**
 * Applies issued-token claim bindings after step extraction.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { IStepConfig } from '../ConfigContracts/index.js';
import { captureJwtClaims } from '../Jwt/JwtClaimCapture.js';
import type { ITemplateScope } from '../Template/RefResolver.js';

/**
 * Checks a step's issued token before its derivations and later requests.
 * @param step - Step configuration.
 * @param scope - Scope with the step's newly extracted carry.
 * @returns The scope with checked claims, or a value-free refusal.
 */
function applyJwtCapture(step: IStepConfig, scope: ITemplateScope): Procedure<ITemplateScope> {
  const capture = step.structuredCapture;
  if (capture?.kind !== 'jwt-claims') return succeed(scope);
  const claims = captureJwtClaims(capture, scope);
  if (!isOk(claims)) return claims;
  return succeed({ ...scope, carry: { ...scope.carry, ...claims.value } });
}

export default applyJwtCapture;
export { applyJwtCapture };
