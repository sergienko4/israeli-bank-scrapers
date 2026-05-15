/**
 * Phase H'' — `readDateWindowParams` contract.
 *
 * <p>Pure read of `harvest.dateWindowParamsByAccount`. Returns the
 * first map entry's tuple, or the empty sentinel when the map is
 * absent / empty / iteration finds no entry. Used by SCRAPE.PRE to
 * pluck the WK-aliased `[fromAlias, toAlias]` tuple before handing
 * the per-account fetch context to strategies.
 */

import {
  EMPTY_TXN_HARVEST,
  readDateWindowParams,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import type { IDashboardTxnHarvest } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/**
 * Builds a harvest carrying a populated date-window map. Local to
 * this file because the function under test reads only that field.
 * @param map - Map override.
 * @returns Synthetic harvest for the function-under-test.
 */
function harvestWithMap(map: ReadonlyMap<string, readonly string[]>): IDashboardTxnHarvest {
  return { ...EMPTY_TXN_HARVEST, dateWindowParamsByAccount: map };
}

/**
 * Builds a harvest that omits the date-window map field entirely.
 * Mirrors a DASHBOARD harvest from a pool with no WK alias pair.
 * @returns Synthetic harvest with no map field set.
 */
function harvestWithoutMap(): IDashboardTxnHarvest {
  return { ...EMPTY_TXN_HARVEST };
}

describe("readDateWindowParams — Phase H'' SCRAPE.PRE reader", () => {
  it('returns the empty tuple when the harvest carries no map field', (): void => {
    const harvest = harvestWithoutMap();
    const result = readDateWindowParams(harvest);

    expect(result).toEqual([]);
  });

  it('returns the empty tuple when the map is present but empty', (): void => {
    const harvest = harvestWithMap(new Map());
    const result = readDateWindowParams(harvest);

    expect(result).toEqual([]);
  });

  it('returns the first map value when one entry is present', (): void => {
    const harvest = harvestWithMap(
      new Map([['00-000-000000', ['retrievalStartDate', 'retrievalEndDate']]]),
    );
    const result = readDateWindowParams(harvest);

    expect(result).toEqual(['retrievalStartDate', 'retrievalEndDate']);
  });

  it('returns the FIRST map value when several entries are present', (): void => {
    const harvest = harvestWithMap(
      new Map([
        ['00-000-000000', ['retrievalStartDate', 'retrievalEndDate']],
        ['11-111-111111', ['startDate', 'endDate']],
      ]),
    );
    const result = readDateWindowParams(harvest);

    expect(result).toEqual(['retrievalStartDate', 'retrievalEndDate']);
  });
});
