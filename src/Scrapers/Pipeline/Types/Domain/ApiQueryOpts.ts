/**
 * IApiQueryOpts — per-call ApiMediator options (pure DTO leaf).
 *
 * Extracted to `Types/Domain` so narrow capability ports (e.g.
 * {@link ITokenBus}) can reference it without importing the ApiMediator
 * cluster, keeping those ports outside the ApiMediator dependency SCC.
 */

/** Per-call options — extraHeaders + optional URL query params + optional Set-Cookie hook. */
interface IApiQueryOpts {
  readonly extraHeaders?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly onSetCookie?: (setCookies: readonly string[]) => number;
}

export type { IApiQueryOpts };
