/**
 * TokenStrategyFromConfig — barrel re-exporting the split sibling modules.
 * Public surface preserved: createTokenStrategyFromConfig + related types.
 */

export { createTokenStrategyFromConfig } from './TokenStrategyFromConfig.factory.js';
export type {
  GenericCreds,
  IConfigTokenStrategy,
  ICreateTokenStrategyArgs,
} from './TokenStrategyFromConfig.types.js';
