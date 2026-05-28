/**
 * Shared interfaces for the scrape phase modules.
 * Bundled parameter objects for lint max-params compliance.
 */

import type { INetworkDiscovery } from '../../Mediator/Network/NetworkDiscovery.js';
import type { JsonValue } from '../../Types/JsonValue.js';
import type {
  IApiFetchContext,
  IBillingCycleCatalog,
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
 * Untyped API value — alias of the shared structural {@link JsonValue}
 * union. Closes Sonar S6564 (`typescript:S6564`): the prior
 * `type ApiValue = unknown` alias was redundant; the union RHS
 * is accepted as non-redundant. Domain name preserved to avoid a
 * cascade across the strategy callers.
 */
type ApiValue = JsonValue;
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
   * Phase E (PR-α'): per-card billing-cycle catalog committed by
   * ACCOUNT-RESOLVE.POST. When present, {@link tryMatrixLoop} iterates
   * the canonical cycles surfaced by the bank itself instead of the
   * blind month-chunk plan. Absent for non-cycling banks (current
   * accounts) — the matrix loop falls back to `generateMonthChunks`.
   * Optional at the type level so legacy SCRAPE tests stay terse.
   */
  readonly billingCycleCatalog?: IBillingCycleCatalog;
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
  /**
   * Phase G: per-card dedup-key field tuple sourced from
   * `harvest.dedupKeyFieldsByAccount`. SCRAPE.PRE plucks the
   * applicable tuple for the current iteration before handing fc to
   * strategies. Optional at type level so legacy tests stay terse —
   * production always populates. Strategies use a one-line ergonomic
   * default `['identifier']` when absent.
   */
  readonly dedupKeyFields?: readonly string[];
  /**
   * Phase H'' (2026-05-15): WK-aliased `[fromAlias, toAlias]` URL
   * parameter tuple sourced from
   * `harvest.dateWindowParamsByAccount`. SCRAPE.PRE plucks the tuple
   * for the current iteration; strategies pass it into
   * `applyDateRangeToUrl` so the per-cycle window query is built with
   * the bank's actual WK alias names. Optional at type level — when
   * absent, `applyDateRangeToUrl` keeps its replace-only semantics
   * (no append) so non-Hapoalim banks are unaffected.
   */
  readonly dateWindowParams?: readonly string[];
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

/**
 * Bundled params for account assembly.
 *
 * <p>v4 (2026-05-27): `rawRecord` removed. Balance resolution moved
 * to the BALANCE-RESOLVE phase, which consumes
 * `scrape.perAccountResponses` directly. SCRAPE's assembly owns only
 * `accountNumber` derivation; balance is merged downstream by
 * `PipelineResult.combineWithBalance`.
 */
interface IAccountAssemblyCtx {
  readonly fc: IAccountFetchCtx;
  readonly accountId: string;
  readonly displayId: string;
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
