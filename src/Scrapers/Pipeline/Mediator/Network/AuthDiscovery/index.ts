/**
 * AuthDiscovery barrel — explicit re-exports of the historical public surface.
 *
 * Internal helpers in each tier file remain private; only the names
 * exposed by the legacy `Mediator/Network/AuthDiscovery.ts` monolith
 * leak through here.
 */

export { discoverFromHeaders } from './HeadersTier.js';
export { default as discoverAuthThreeTier } from './Orchestrator.js';
export { AUTH_HEADER_NAMES } from './Tokens.js';
