/**
 * IApiQueryOpts — per-call ApiMediator options (pure DTO leaf).
 *
 * Extracted to `Types/Domain` so narrow capability ports (e.g.
 * {@link ITokenBus}) can reference it without importing the ApiMediator
 * cluster, keeping those ports outside the ApiMediator dependency SCC.
 */

import type { IFetchCallPolicy } from './FetchPolicy.js';

/**
 * Per-call options — extraHeaders + optional URL query params + optional
 * Set-Cookie hook + optional transport policy (e.g. how to treat a redirect).
 */
interface IApiQueryOpts {
  readonly extraHeaders?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly onSetCookie?: (setCookies: readonly string[]) => number;
  readonly policy?: IFetchCallPolicy;
}

export type { IApiQueryOpts };
