/**
 * Shared types and constants for the ScrapeAutoMapper cluster.
 * Co-located with the facade so every sub-module under
 * `Pipeline/Mediator/Scrape/` imports a single canonical home.
 */

import type { JsonValue } from '../../../Types/JsonValue.js';

/** API response record — wraps Record to hide `unknown` from function signatures. */
export type ApiRecord = Record<string, unknown>;

/**
 * Untyped value crossing module boundaries — alias of the shared
 * {@link JsonValue} structural union from
 * `Pipeline/Types/JsonValue.ts`. Closes Sonar S6564 (the prior
 * `type UntypedValue = unknown` alias was redundant); the
 * structural union RHS is accepted as non-redundant because it is a
 * `TSUnionType`, not a bare `TSUnknownKeyword`. Domain
 * name retained (`UntypedValue`) so the call-sites do not need renaming.
 */
export type UntypedValue = JsonValue;

/**
 * Result of probing a record for a scalar field — the raw scalar
 * (string or number) when found, or `false` to mark a miss. Reused
 * widely by findFieldValue, coerceString, coerceNumber, and the
 * amount-resolution helpers; named here to keep the union out of
 * every signature (Sonar S4323).
 */
export type ScalarFieldHit = string | number | false;

/** Default currency when none found in API response. */
export const DEFAULT_CURRENCY = 'ILS';

/** Max depth for BFS field search. */
export const MAX_SEARCH_DEPTH = 10;
