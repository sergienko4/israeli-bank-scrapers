/* eslint-disable import-x/max-dependencies */
import { CompanyTypes } from '../../Definitions';
import AmexScraper from '../Amex/AmexScraper';
import { type Scraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface';
import { ScraperWebsiteChangedError } from '../Base/ScraperWebsiteChangedError';
import BehatsdaaScraper from '../Behatsdaa/BehatsdaaScraper';
import BeinleumiScraper from '../Beinleumi/BeinleumiScraper';
import BeyahadBishvilhaScraper from '../BeyahadBishvilha/BeyahadBishvilhaScraper';
import DiscountScraper from '../Discount/DiscountScraper';
import HapoalimScraper from '../Hapoalim/HapoalimScraper';
import IsracardScraper from '../Isracard/IsracardScraper';
import LeumiScraper from '../Leumi/LeumiScraper';
import MassadScraper from '../Massad/MassadScraper';
import MaxScraper from '../Max/MaxScraper';
import MercantileScraper from '../Mercantile/MercantileScraper';
import MizrahiScraper from '../Mizrahi/MizrahiScraper';
import OneZeroScraper from '../OneZero/OneZeroScraper';
import OtsarHahayalScraper from '../OtsarHahayal/OtsarHahayalScraper';
import PagiScraper from '../Pagi/PagiScraper';
import VisaCalScraper from '../VisaCal/VisaCalScraper';
import YahavScraper from '../Yahav/YahavScraper';

type ScraperFactory = (options: ScraperOptions) => Scraper<ScraperCredentials>;

const SCRAPER_REGISTRY: Partial<Record<CompanyTypes, ScraperFactory>> = {
  [CompanyTypes.Hapoalim]: o => new HapoalimScraper(o),
  [CompanyTypes.Leumi]: o => new LeumiScraper(o),
  [CompanyTypes.BeyahadBishvilha]: o => new BeyahadBishvilhaScraper(o),
  [CompanyTypes.Mizrahi]: o => new MizrahiScraper(o),
  [CompanyTypes.Discount]: o => new DiscountScraper(o),
  [CompanyTypes.Mercantile]: o => new MercantileScraper(o),
  [CompanyTypes.OtsarHahayal]: o => new OtsarHahayalScraper(o),
  [CompanyTypes.VisaCal]: o => new VisaCalScraper(o),
  [CompanyTypes.Max]: o => new MaxScraper(o),
  [CompanyTypes.Isracard]: o => new IsracardScraper(o),
  [CompanyTypes.Amex]: o => new AmexScraper(o),
  [CompanyTypes.Beinleumi]: o => new BeinleumiScraper(o),
  [CompanyTypes.Massad]: o => new MassadScraper(o),
  [CompanyTypes.Yahav]: o => new YahavScraper(o),
  [CompanyTypes.OneZero]: o => new OneZeroScraper(o),
  [CompanyTypes.Behatsdaa]: o => new BehatsdaaScraper(o),
  [CompanyTypes.Pagi]: o => new PagiScraper(o),
};

export default function createScraper(options: ScraperOptions): Scraper<ScraperCredentials> {
  const factory = SCRAPER_REGISTRY[options.companyId];
  if (factory) return factory(options);
  throw new ScraperWebsiteChangedError('Factory', `unknown company id ${options.companyId}`);
}
