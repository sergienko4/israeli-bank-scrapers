/**
 * Shared JSON type alias for ScrapeReplay sub-modules.
 * Kept in its own file so both JsonReplace.ts and Base64Paging.ts
 * can import the alias without creating an import cycle.
 */

import type { JsonNode } from '../JsonTraversal.js';

/** A dynamic JSON record from parsed API responses. */
export type JsonRecord = Record<string, JsonNode>;
