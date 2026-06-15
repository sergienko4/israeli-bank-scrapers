/**
 * ScrapeExecutor / Types — shared brands + bundled-argument shapes for
 * the generic scrape executor. Extracted from `ScrapeExecutor.ts` as
 * part of the Phase 12e file-size drain so the orchestrator, fetch, and
 * account-assembly halves share one canonical contract surface.
 */

import type { Brand } from '../../../Types/Brand.js';
import type { IScrapeConfig } from '../../../Types/ScrapeConfig.js';
import type { IFetchOpts, IFetchStrategy } from '../../Fetch/FetchStrategy.js';

type StartDateFormatted = Brand<string, 'StartDateFormatted'>;
type ExtractedBalance = Brand<number, 'ExtractedBalance'>;

/** Bundled dependencies for scrape operations. */
interface IScrapeOps<TA, TT> {
  readonly strategy: IFetchStrategy;
  readonly config: IScrapeConfig<TA, TT>;
  readonly opts: IFetchOpts;
  readonly startDate: string;
}

/** Built request shape from buildRequest callback. */
interface IBuiltRequest {
  readonly path: string;
  readonly postData: Record<string, string>;
}

/** Fetch dispatch arguments. */
interface IDispatchArgs {
  readonly strategy: IFetchStrategy;
  readonly method: string;
  readonly path: string;
  readonly postData: Record<string, string>;
  readonly opts: IFetchOpts;
}

export type { ExtractedBalance, IBuiltRequest, IDispatchArgs, IScrapeOps, StartDateFormatted };
