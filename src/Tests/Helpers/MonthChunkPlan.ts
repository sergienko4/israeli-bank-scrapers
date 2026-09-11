import type { IMonthChunk } from '../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/MonthChunking.js';

/**
 * Narrow a month plan that a test expects generation to accept.
 * @param plan - Generated chunks or rejection.
 * @returns Accepted chunks.
 * @throws {RangeError} When generation rejected the test fixture.
 */
export default function requireMonthChunks(
  plan: readonly IMonthChunk[] | false,
): readonly IMonthChunk[] {
  if (plan === false) throw new RangeError('Expected a valid month chunk plan');
  return plan;
}
