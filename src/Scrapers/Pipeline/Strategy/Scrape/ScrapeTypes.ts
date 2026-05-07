/**
 * Shared interfaces for the scrape phase modules.
 * Bundled parameter objects for lint max-params compliance.
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../Mediator/Network/NetworkDiscovery.js';
import type { IApiFetchContext } from '../../Types/PipelineContext.js';

/** API response payload — wraps Record to hide `unknown` from function signatures. */
type ApiPayload = Record<string, unknown>;
/**
 * Untyped API value — named alias kept to satisfy the architecture
 * `no-restricted-syntax` rule that forbids bare `unknown` in function
 * signatures. NOSONAR rationale below.
 */
// NOSONAR — architecture rule no-restricted-syntax requires named alias for 'unknown'
type ApiValue = unknown;
/** Untyped API array — wraps `unknown[]` to satisfy no-unknown-in-signatures ESLint rule. */
type ApiValueArray = ApiValue[];

/** Bundled context for fetching one account's data. */
interface IAccountFetchCtx {
  readonly api: IApiFetchContext;
  readonly network: INetworkDiscovery;
  readonly startDate: string;
  readonly futureMonths?: number;
  /**
   * TXN endpoint resolved by DASHBOARD.FINAL and forwarded by SCRAPE.PRE.
   * Phase 7e: SCRAPE strategies read this field instead of calling
   * `network.discoverTransactionsEndpoint()` themselves — the architecture
   * test enforces zero discovery calls outside DASHBOARD.
   */
  readonly txnEndpoint?: IDiscoveredEndpoint | false;
  /**
   * Pending-transactions API URL resolved by DASHBOARD.FINAL (Phase 7e
   * R-API). `false` when the bank doesn't expose pending or DASHBOARD
   * skipped the commit (mock-mode bypass).
   */
  readonly pendingUrl?: string | false;
  /**
   * Billing-fallback URL resolved by DASHBOARD.FINAL (Phase 7e R-API).
   * `false` when the bank's family doesn't carry the billing path.
   */
  readonly billingUrl?: string | false;
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
  ApiPayload,
  ApiValue,
  ApiValueArray,
  IAccountAssemblyCtx,
  IAccountFetchCtx,
  IAccountFetchOpts,
  IBillingChunkCtx,
  IChunkingCtx,
  IFetchAllAccountsCtx,
  IPostFetchCtx,
};
