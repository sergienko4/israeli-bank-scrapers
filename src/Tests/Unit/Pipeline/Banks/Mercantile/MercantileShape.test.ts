/**
 * Mercantile hard-model scrape shape — Mercantile reads the same Titan tenant
 * as Discount, so its shape is Discount's under its own step name. The
 * Discount shape suites cover the family's extractors, URLs, headers and
 * answer check; this suite proves Mercantile binds that family unchanged.
 */

import { DISCOUNT_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Discount/scrape/DiscountShape.js';
import { MERCANTILE_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Mercantile/scrape/MercantileShape.js';

describe('MercantileShape', () => {
  it("is Discount's Titan shape under the MercantileScrape step", () => {
    const expected = { ...DISCOUNT_SHAPE, stepName: 'MercantileScrape' };
    expect(MERCANTILE_SHAPE).toEqual(expected);
  });
});
