import { CompanyTypes } from '../../Definitions.js';
import { type ILoginConfig } from '../Base/Config/LoginConfig.js';
import { beinleumiConfig } from '../BaseBeinleumiGroup/Config/BeinleumiLoginConfig.js';
import { BEHATSDAA_CONFIG } from '../Behatsdaa/Config/BehatsdaaLoginConfig.js';
import { BEYAHAD_CONFIG } from '../BeyahadBishvilha/Config/BeyahadBishvilhaLoginConfig.js';
import discountConfig from '../Discount/Config/DiscountLoginConfig.js';
import { HAPOALIM_CONFIG } from '../Hapoalim/Config/HapoalimLoginConfig.js';
import LEUMI_CONFIG from '../Leumi/Config/LeumiLoginConfig.js';
import { MAX_CONFIG } from '../Max/Config/MaxLoginConfig.js';
import { MIZRAHI_CONFIG } from '../Mizrahi/Config/MizrahiLoginConfig.js';
import { YAHAV_CONFIG } from '../Yahav/Config/YahavLoginConfig.js';
import { SCRAPER_CONFIGURATION } from './Config/ScraperConfig.js';

/** Registry mapping CompanyTypes to their declarative login configurations. */
const BANK_REGISTRY: Partial<Record<CompanyTypes, ILoginConfig>> = {
  [CompanyTypes.Beinleumi]: beinleumiConfig(
    SCRAPER_CONFIGURATION.banks[CompanyTypes.Beinleumi].urls.base,
  ),
  [CompanyTypes.OtsarHahayal]: beinleumiConfig(
    SCRAPER_CONFIGURATION.banks[CompanyTypes.OtsarHahayal].urls.base,
  ),
  [CompanyTypes.Massad]: beinleumiConfig(
    SCRAPER_CONFIGURATION.banks[CompanyTypes.Massad].urls.base,
  ),
  [CompanyTypes.Pagi]: beinleumiConfig(SCRAPER_CONFIGURATION.banks[CompanyTypes.Pagi].urls.base),
  // [CompanyTypes.Discount]: discountConfig(
  //   SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount].urls.base,
  // ),
  [CompanyTypes.Mercantile]: discountConfig(
    SCRAPER_CONFIGURATION.banks[CompanyTypes.Mercantile].urls.base,
  ),
  [CompanyTypes.Hapoalim]: HAPOALIM_CONFIG,
  [CompanyTypes.Leumi]: LEUMI_CONFIG,
  [CompanyTypes.Mizrahi]: MIZRAHI_CONFIG,
  [CompanyTypes.Max]: MAX_CONFIG,
  [CompanyTypes.Behatsdaa]: BEHATSDAA_CONFIG,
  [CompanyTypes.BeyahadBishvilha]: BEYAHAD_CONFIG,
  // [CompanyTypes.VisaCal]: VISACAL_LOGIN_CONFIG,
  [CompanyTypes.Yahav]: YAHAV_CONFIG,
};

export { BANK_REGISTRY };
export default BANK_REGISTRY;
