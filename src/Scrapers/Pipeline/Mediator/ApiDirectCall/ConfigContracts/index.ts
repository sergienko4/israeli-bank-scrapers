/**
 * ApiDirectCall ConfigContracts — barrel re-export.
 *
 * Wide-import surface for the API-DIRECT-CALL config-tree:
 *
 *     import type {...} from '.../ConfigContracts/index.js';
 *
 * Prefer the narrow per-bucket sub-modules
 * (`./TemplateTypes.js`, `./SignerTypes.js`, `./CarryTypes.js`,
 * `./EnvelopeTypes.js`, `./FlowTypes.js`,
 * `./ApiDirectCallConfig.js`) when call-sites only need a slice.
 *
 * The legacy `../IApiDirectCallConfig.js` shim re-exports through
 * this barrel for backward compatibility with the 53 historical
 * importers; that shim is deprecated and slated for removal in v8.6.
 */

export * from './ApiDirectCallConfig.js';
export * from './CarryTypes.js';
export * from './EnvelopeTypes.js';
export * from './FlowTypes.js';
export * from './SignerTypes.js';
export * from './TemplateTypes.js';
