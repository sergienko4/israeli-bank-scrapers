/**
 * ApiMediator barrel — headless transport mediator (the Black Box).
 * Re-exports the public surface from co-located siblings:
 * `.types`, `.transport`, `.state`, `.retry`, `.ops`, `.builders`,
 * `.factory`, `.factories`.
 */

export {
  createBrowserBackedHeadlessApiMediator,
  createHeadlessApiMediator,
} from './ApiMediator.factories.js';
export { createApiMediator } from './ApiMediator.factory.js';
export type {
  IApiMediator,
  IApiQueryOpts,
  IBrowserBackedHeadlessMediatorArgs,
  RecoveredHook,
  SessionContext,
} from './ApiMediator.types.js';
