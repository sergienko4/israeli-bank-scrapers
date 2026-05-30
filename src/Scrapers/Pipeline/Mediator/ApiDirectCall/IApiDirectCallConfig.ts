/**
 * IApiDirectCallConfig — DEPRECATED LEGACY SHIM.
 *
 * @deprecated since v8.5 — import from
 *   `./ConfigContracts/index.js` (wide) or a narrow per-bucket
 *   sub-module (e.g. `./ConfigContracts/SignerTypes.js`) instead.
 *   This shim re-exports the full ApiDirectCall config-contract
 *   surface so the 53 historical importers compile unchanged.
 *   Slated for removal in v8.6.
 *
 * Rule #11 compliance: zero bank-name strings — the shim carries
 * only type re-exports from the focused ConfigContracts cluster.
 */

export * from './ConfigContracts/index.js';
