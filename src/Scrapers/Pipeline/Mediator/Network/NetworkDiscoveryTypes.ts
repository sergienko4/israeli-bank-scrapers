/**
 * Re-export barrel — the type cluster moved to
 * Mediator/Network/Types/ in Phase 12c. New code should import
 * directly from './Types/Endpoint.js' or './Types/Discovery.js'.
 * This barrel preserves the existing NetworkDiscoveryTypes.js
 * import path so the 63 type-only consumers continue to resolve
 * unchanged.
 */

export type { INetworkDiscovery } from './Types/Discovery.js';
export type { IDiscoveredEndpoint, PickerTier } from './Types/Endpoint.js';
