/**
 * Locate the api-direct call config a bank config module exports.
 *
 * <p>The registry keeps the named `*_API_DIRECT_CALL` export after the
 * dead default was removed, so tests that load a bank module by path need
 * one lookup rather than a per-bank export-name table.
 */

import type { IApiDirectCallConfig } from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

/**
 * Find the single `*_API_DIRECT_CALL` export name on a loaded bank module.
 * @param loaded - Dynamically imported bank config module.
 * @returns The export name.
 * @throws {TypeError} When the module has no such export.
 */
function findCallExport(loaded: Readonly<Record<string, unknown>>): string {
  const key = Object.keys(loaded).find((name): boolean => name.endsWith('_API_DIRECT_CALL'));
  if (key === undefined) {
    throw new TypeError('bank config module has no *_API_DIRECT_CALL export');
  }
  return key;
}

/**
 * Read the api-direct call config from a loaded bank module. A default-only
 * module wins; the named `*_API_DIRECT_CALL` fallback covers modules that
 * still export both forms.
 * @param loaded - Dynamically imported bank config module.
 * @returns The module's api-direct call config.
 */
function callOfModule(loaded: Readonly<Record<string, unknown>>): IApiDirectCallConfig {
  const fallback = loaded.default;
  if (fallback !== undefined) return fallback as IApiDirectCallConfig;
  return loaded[findCallExport(loaded)] as IApiDirectCallConfig;
}

export { callOfModule, findCallExport };
