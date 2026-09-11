/**
 * DIRECT scrape context date-boundary regression.
 */

import { buildLoadCtxInputs } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhase/DirectFetch.js';
import { EMPTY_TXN_ENDPOINT } from '../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type { IApiFetchContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { EMPTY_TXN_HARVEST } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { underZone } from '../../../Helpers/AmbientZone.js';
import {
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';

/**
 * Build the inert API value passed through the context builder.
 * @returns API context whose behavior is not used by this pure builder.
 */
function makeApi(): IApiFetchContext {
  return {} as IApiFetchContext;
}

describe('buildLoadCtxInputs startDate', () => {
  it('DIRECT-START-DATE-001 — renders the caller instant in the bank calendar', () => {
    const base = makeMockContext();
    const options = { ...base.options, startDate: new Date('2026-03-01T21:30:00.000Z') };
    const input = { ...base, options };
    const mediator = makeMockMediator();
    const reads = { network: mediator.network, txnEndpoint: EMPTY_TXN_ENDPOINT };
    const ready = { input, mediator, api: makeApi() };
    const args = { ready, reads: { ...reads, harvest: EMPTY_TXN_HARVEST } };
    const result = underZone('Pacific/Kiritimati', () => buildLoadCtxInputs(args));
    expect(result.fc.startDate).toBe('20260301');
  });
});
