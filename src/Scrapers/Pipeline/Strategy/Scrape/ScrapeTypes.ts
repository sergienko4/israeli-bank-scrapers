/**
 * Shared interfaces for the scrape phase modules.
 * Bundled parameter objects for lint max-params compliance.
 */

import type { INetworkDiscovery } from '../../Mediator/Network/NetworkDiscovery.js';
import type {
  IApiFetchContext,
  IDashboardTxnHarvest,
  ITxnEndpoint,
  ITxnFieldMap,
} from '../../Types/PipelineContext.js';

/**
 * Phase 7f shared default — used by every SCRAPE-side reader that
 * unwraps the optional `fc.txnEndpoint`. Centralised here so
 * Strategy/Scrape/* files have one import source and the
 * Mediator/Scrape/ScrapePhaseActions ↔ Strategy/Scrape/* graph stays
 * acyclic. Empty-string url signals "no endpoint committed".
 */
const EMPTY_FIELD_MAP: ITxnFieldMap = {
  date: '',
  amount: '',
  description: '',
  currency: '',
  identifier: '',
  originalAmount: false,
  processedDate: false,
  balance: false,
};
const EMPTY_TXN_ENDPOINT: ITxnEndpoint = {
  url: '',
  method: 'GET',
  templatePostData: false,
  fieldMap: EMPTY_FIELD_MAP,
  pendingUrl: false,
  billingUrl: false,
};

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

/**
 * Bundled context for fetching one account's data. Phase 7f: TXN
 * endpoint is the slim typed {@link ITxnEndpoint} committed by
 * DASHBOARD.FINAL — strategies read its fields directly. The legacy
 * `IDiscoveredEndpoint` shape and the sibling pendingUrl / billingUrl
 * are no longer surfaced separately; they live nested inside
 * `txnEndpoint`. The `network` field is retained for the
 * still-pending balance / displayId lookups; it will be removed in
 * the same atomic commit that migrates those helpers to consume
 * `ctx.accountDiscovery` instead.
 */
interface IAccountFetchCtx {
  readonly api: IApiFetchContext;
  readonly network: INetworkDiscovery;
  readonly startDate: string;
  readonly futureMonths?: number;
  /**
   * Phase 7f: slim TXN endpoint committed by DASHBOARD.FINAL. Optional
   * at the type level so test fixtures that don't exercise the field
   * stay terse; SCRAPE strategies treat absent / empty-url as
   * "no endpoint" via the {@link EMPTY_TXN_ENDPOINT_DEFAULT} read-site
   * default. Production SCRAPE.PRE always populates this from
   * `ctx.txnEndpoint` via `readPreDiscoveredTxn`.
   */
  readonly txnEndpoint?: ITxnEndpoint;
  /**
   * Phase 7f follow-up: DASHBOARD-side TXN harvest committed by
   * DASHBOARD.FINAL. Carries the pre-extracted records DASHBOARD
   * captured + scope metadata so SCRAPE can attribute them to the
   * matching iteration without re-fetching. Optional at the type
   * level — production SCRAPE.PRE always populates from
   * `ctx.dashboardTxnHarvest` via `readDashboardTxnHarvest`. SCRAPE
   * strategies fall back to `EMPTY_TXN_HARVEST` when omitted.
   */
  readonly dashboardTxnHarvest?: IDashboardTxnHarvest;
}

/** Bundled options for fetching one account. */
interface IAccountFetchOpts {
  readonly accountRecord?: Record<string, unknown>;
  readonly txnEndpoint?: ITxnEndpoint;
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

/**
 * Bundled params for fetching all accounts. Phase 7f: txnEndpoint is
 * optional at the type level (matches IAccountFetchCtx). Production
 * SCRAPE.PRE always populates it from `ctx.txnEndpoint`; tests that
 * exercise non-endpoint branches may omit.
 */
interface IFetchAllAccountsCtx {
  readonly fc: IAccountFetchCtx;
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
  readonly txnEndpoint?: ITxnEndpoint;
  readonly dashboardTxnHarvest?: IDashboardTxnHarvest;
}

export { EMPTY_FIELD_MAP, EMPTY_TXN_ENDPOINT };
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
