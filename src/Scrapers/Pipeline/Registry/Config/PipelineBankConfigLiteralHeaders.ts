/**
 * Fixed header maps as step header templates, for the bank configs whose
 * login steps send constant headers.
 */

import type { JsonValueTemplate } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

/** Step headers, templated. */
type StepHeaders = Readonly<Record<string, JsonValueTemplate>>;

/**
 * Template every value of a fixed header map as a literal.
 * @param headers - Fixed header map.
 * @returns The same headers as step templates.
 */
function literalHeaders(headers: Readonly<Record<string, string>>): StepHeaders {
  const entries = Object.entries(headers).map(([name, value]) => [name, { $literal: value }]);
  return Object.fromEntries(entries) as StepHeaders;
}

export default literalHeaders;
export { literalHeaders };
