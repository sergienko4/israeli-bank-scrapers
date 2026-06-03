/**
 * Credential-key narrowing + Page/Frame discrimination helpers.
 */

import type { Frame, Page } from 'playwright-core';

import type { CredentialKey } from './SelectorResolver.types.js';
import { CREDENTIAL_KEY_MAP, MIN_ID_LENGTH } from './SelectorResolverConfig.js';

/**
 * True when `pageOrFrame` is a full Page (has `frames()` method).
 * @param pageOrFrame - The Playwright Page or Frame to check.
 * @returns Whether the argument is a Page instance.
 */
function isPage(pageOrFrame: Page | Frame): pageOrFrame is Page {
  return 'frames' in pageOrFrame && typeof pageOrFrame.frames === 'function';
}

/**
 * Search CREDENTIAL_KEY_MAP for a key that appears as a substring of the input.
 * @param lower - The lowercased identifier to search within.
 * @returns The matched credential key, or empty string if none found.
 */
function findPartialCredentialMatch(lower: string): string {
  const entries = Object.entries(CREDENTIAL_KEY_MAP);
  const match = entries.find(([key]): boolean => lower.includes(key));
  if (!match) return String();
  return match[1];
}

/**
 * Extract the most likely WELL_KNOWN_SELECTORS key from a CSS selector string.
 * @param selector - A CSS selector string such as '#username' or '#tzId'.
 * @returns The normalized credential key (e.g. 'username', 'password', 'id', 'num').
 */
function extractCredentialKey(selector: string): CredentialKey {
  const id = /^#([\w-]+)/.exec(selector)?.[1] ?? selector;
  const lower = id.toLowerCase();
  const directMatch = CREDENTIAL_KEY_MAP[lower];
  if (directMatch) return directMatch as CredentialKey;
  const partialMatch = findPartialCredentialMatch(lower);
  if (partialMatch) return partialMatch as CredentialKey;
  if (lower.startsWith('id') && lower.length <= MIN_ID_LENGTH) return 'id' as CredentialKey;
  return id as CredentialKey;
}

export { extractCredentialKey, findPartialCredentialMatch, isPage };
