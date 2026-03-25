/**
 * Shared interfaces for the scrape phase modules.
 * Bundled parameter objects for lint max-params compliance.
 */

import type { IDiscoveredEndpoint, INetworkDiscovery } from '../Mediator/NetworkDiscovery.js';
import type { IApiFetchContext } from '../Types/PipelineContext.js';

/** API response payload — wraps Record to hide `unknown` from function signatures. */
type ApiPayload = Record<string, unknown>;

/** Bundled context for fetching one account's data. */
interface IAccountFetchCtx {
  readonly api: IApiFetchContext;
  readonly network: INetworkDiscovery;
  readonly startDate: string;
}

/** Bundled options for fetching one account. */
interface IAccountFetchOpts {
  readonly accountRecord?: Record<string, unknown>;
  readonly txnEndpoint?: IDiscoveredEndpoint | false;
}

/** Bundled context for monthly chunking operations. */
interface IChunkingCtx {
  readonly fc: IAccountFetchCtx;
  readonly baseBody: Record<string, unknown>;
  readonly url: string;
  readonly displayId: string;
  readonly accountId: string;
}

/** Bundled params for POST fetch operations. */
interface IPostFetchCtx {
  readonly baseBody: Record<string, unknown>;
  readonly url: string;
  readonly displayId: string;
  readonly accountId: string;
}

/** Bundled params for billing chunk fetches. */
interface IBillingChunkCtx {
  readonly fc: IAccountFetchCtx;
  readonly billingUrl: string;
  readonly accountId: string;
}

/** Bundled params for account assembly. */
interface IAccountAssemblyCtx {
  readonly fc: IAccountFetchCtx;
  readonly accountId: string;
  readonly displayId: string;
}

/** Bundled params for fetching all accounts. */
interface IFetchAllAccountsCtx {
  readonly fc: IAccountFetchCtx;
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
  readonly txnEndpoint: IDiscoveredEndpoint | false;
}

export type {
  ApiPayload,
  IAccountAssemblyCtx,
  IAccountFetchCtx,
  IAccountFetchOpts,
  IBillingChunkCtx,
  IChunkingCtx,
  IFetchAllAccountsCtx,
  IPostFetchCtx,
};
