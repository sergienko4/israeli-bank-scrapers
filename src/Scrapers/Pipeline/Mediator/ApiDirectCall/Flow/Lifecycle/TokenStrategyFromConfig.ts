/**
 * TokenStrategyFromConfig — barrel re-exporting the split sibling modules.
 * Public surface preserved: createTokenStrategyFromConfig + related types.
 */

export { default as createTokenStrategyFromConfig } from './TokenStrategyFromConfig.factory.js';
export type {
  GenericCreds,
  IConfigTokenStrategy,
  ICreateTokenStrategyArgs,
  PersistentAuthMode,
} from './TokenStrategyFromConfig.types.js';
