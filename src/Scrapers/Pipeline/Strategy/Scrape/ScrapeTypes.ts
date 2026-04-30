/**
 * Shared interfaces for the scrape phase modules.
 * Bundled parameter objects for lint max-params compliance.
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../Mediator/Network/NetworkDiscovery.js';
import type { IApiFetchContext } from '../../Types/PipelineContext.js';

/** Unique internal ID used for API queries (e.g. cardUniqueId). */
type AccountId = string;
/** Display ID shown to the user (e.g. last4Digits or accountNumber). */
type DisplayId = string;
/** URL string for an API endpoint. */
type UrlStr = string;
/** ISO or YYYYMMDD date string. */
type DateStr = string;
/** Billing API endpoint URL. */
type BillingUrlStr = string;
/** Number of future billing months to include beyond today. */
type FutureMonthCount = number;

/** API response payload — wraps Record to hide `unknown` from function signatures. */
type ApiPayload = Record<string, unknown>;
/** Untyped API value — wraps `unknown` to satisfy no-unknown-in-signatures ESLint rule. */
type ApiValue = unknown;
/** Untyped API array — wraps `unknown[]` to satisfy no-unknown-in-signatures ESLint rule. */
type ApiValueArray = ApiValue[];

/** Bundled context for fetching one account's data. */
interface IAccountFetchCtx {
  readonly api: IApiFetchContext;
  readonly network: INetworkDiscovery;
  readonly startDate: DateStr;
  readonly futureMonths?: FutureMonthCount;
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
  readonly url: UrlStr;
  readonly displayId: DisplayId;
  readonly accountId: AccountId;
}

/** Bundled params for POST fetch operations. */
interface IPostFetchCtx {
  readonly baseBody: Record<string, unknown>;
  readonly url: UrlStr;
  readonly displayId: DisplayId;
  readonly accountId: AccountId;
}

/** Bundled params for billing chunk fetches. */
interface IBillingChunkCtx {
  readonly fc: IAccountFetchCtx;
  readonly billingUrl: BillingUrlStr;
  readonly accountId: AccountId;
}

/** Bundled params for account assembly. */
interface IAccountAssemblyCtx {
  readonly fc: IAccountFetchCtx;
  readonly accountId: AccountId;
  readonly displayId: DisplayId;
  /** Optional raw record captured during discovery — used for record-first balance extraction. */
  readonly rawRecord?: Record<string, unknown>;
}

/** Bundled params for fetching all accounts. */
interface IFetchAllAccountsCtx {
  readonly fc: IAccountFetchCtx;
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
  readonly txnEndpoint: IDiscoveredEndpoint | false;
}

export type {
  AccountId,
  ApiPayload,
  ApiValue,
  ApiValueArray,
  BillingUrlStr,
  DateStr,
  DisplayId,
  FutureMonthCount,
  IAccountAssemblyCtx,
  IAccountFetchCtx,
  IAccountFetchOpts,
  IBillingChunkCtx,
  IChunkingCtx,
  IFetchAllAccountsCtx,
  IPostFetchCtx,
  UrlStr,
};
