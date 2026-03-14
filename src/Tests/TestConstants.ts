/**
 * Test constants derived from scraper configuration.
 *
 * Centralises hardcoded URLs used across integration tests so they
 * stay in sync with the production login configs.
 */
import { CompanyTypes } from '../Definitions.js';
import { DISCOUNT_SUCCESS_URL } from '../Scrapers/Discount/Config/DiscountLoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Scrapers/Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks;

/** Hapoalim primary success URL (first possibleResults entry). */
export const HAPOALIM_SUCCESS_URL = 'https://login.bankhapoalim.co.il/portalserver/HomePage';

/** Leumi success URL matching the `/ebanking/SO/SPA.aspx` pattern. */
export const LEUMI_SUCCESS_URL = 'https://hb2.bankleumi.co.il/ebanking/SO/SPA.aspx';

/** Max success URL matching the `/homepage/personal` path. */
export const MAX_SUCCESS_URL = `${CFG[CompanyTypes.Max].urls.base}/homepage/personal`;

/** VisaCal success URL matching the `/dashboard` pattern. */
export const VISACAL_SUCCESS_URL = 'https://digital-web.cal-online.co.il/dashboard';

/** Beinleumi success URL matching the `/Resources/PortalNG/shell` pattern. */
export const BEINLEUMI_SUCCESS_URL = 'https://test.fibi.co.il/Resources/PortalNG/shell';

export { DISCOUNT_SUCCESS_URL };
