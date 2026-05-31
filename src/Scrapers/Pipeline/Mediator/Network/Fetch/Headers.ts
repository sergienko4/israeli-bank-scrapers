/**
 * Fetch sub-module — JSON request headers + JsonValue body type.
 *
 * Pure helpers; no side effects. Shared by NativeFetch + PageFetch.
 */

import { JSON_CONTENT_TYPE } from '../FetchConfig.js';

/** JSON-serializable value for API request/response bodies. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Build standard JSON request headers for API calls.
 * @returns An object with Accept and Content-Type set to JSON.
 */
export function getJsonHeaders(): Record<string, string> {
  return {
    Accept: JSON_CONTENT_TYPE,
    'Content-Type': JSON_CONTENT_TYPE,
  };
}
