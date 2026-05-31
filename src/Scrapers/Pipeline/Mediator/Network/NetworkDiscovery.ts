/**
 * Network Discovery — captures API traffic from browser page.
 * Black box: observes what the page's JavaScript does, stores endpoints.
 * SCRAPE phase can replay discovered patterns with different params.
 *
 * Generic for ALL banks — no bank-specific logic.
 * Captures JSON responses from page.on('response'), ignores HTML/images/fonts.
 */

export { distillHeaders } from '../Elements/HeaderDistillation.js';
export { createNetworkDiscovery } from './DiscoveryEngine/DiscoveryEngine.js';
export { default as createFrozenNetwork } from './FrozenReplay/FrozenReplay.js';
export type {
  IParsedBody,
  IsUnsupportedUrlSignal,
  ShouldRecordResponseSignal,
} from './Indexing/Indexing.js';
export {
  isUnsupportedUrl,
  parseResponse,
  parseTextOrNull,
  shouldRecordResponse,
} from './Indexing/Indexing.js';
export type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';
