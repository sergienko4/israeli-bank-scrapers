/**
 * Phase G — `readDedupKeyFields` contract.
 *
 * <p>Pure read of `harvest.dedupKeyFieldsByAccount`. Returns the
 * first map entry's tuple, or the supplied fallback when the map is
 * absent / empty. Used by SCRAPE.PRE to pluck the per-card dedup-key
 * tuple before handing the per-account fetch context to strategies.
 */

import {
  EMPTY_TXN_HARVEST,
  readDedupKeyFields,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import type { IDashboardTxnHarvest } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const FALLBACK: readonly string[] = Object.freeze(['fallback-field']);

/**
 * Builds a harvest carrying a populated dedup-key-fields map.
 * @param map - Map override.
 * @returns Synthetic harvest for the function-under-test.
 */
function harvestWithMap(map: ReadonlyMap<string, readonly string[]>): IDashboardTxnHarvest {
  return { ...EMPTY_TXN_HARVEST, dedupKeyFieldsByAccount: map };
}

/**
 * Builds a harvest that omits the dedup-key-fields map field entirely.
 * @returns Synthetic harvest with no map field set.
 */
function harvestWithoutMap(): IDashboardTxnHarvest {
  return { ...EMPTY_TXN_HARVEST };
}

describe('readDedupKeyFields — Phase G SCRAPE.PRE reader', () => {
  it('returns the fallback when the harvest carries no map field', (): void => {
    const harvest = harvestWithoutMap();
    const result = readDedupKeyFields(harvest, FALLBACK);

    expect(result).toEqual(['fallback-field']);
  });

  it('returns the fallback when the map is present but empty', (): void => {
    const emptyMap: ReadonlyMap<string, readonly string[]> = new Map();
    const harvest = harvestWithMap(emptyMap);
    const result = readDedupKeyFields(harvest, FALLBACK);

    expect(result).toEqual(['fallback-field']);
  });

  it('returns the first map value when one entry is present', (): void => {
    const harvest = harvestWithMap(new Map([['00-000-000000', ['txnId', 'txnDate']]]));
    const result = readDedupKeyFields(harvest, FALLBACK);

    expect(result).toEqual(['txnId', 'txnDate']);
  });

  it('returns the FIRST map value when several entries are present', (): void => {
    const harvest = harvestWithMap(
      new Map([
        ['00-000-000000', ['txnId', 'txnDate']],
        ['11-111-111111', ['idA', 'idB']],
      ]),
    );
    const result = readDedupKeyFields(harvest, FALLBACK);

    expect(result).toEqual(['txnId', 'txnDate']);
  });
});
