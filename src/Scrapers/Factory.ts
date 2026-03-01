import { CompanyTypes } from '../Definitions';
import AmexScraper from './Amex';
import BehatsdaaScraper from './Behatsdaa';
import BeinleumiScraper from './Beinleumi';
import BeyahadBishvilhaScraper from './BeyahadBishvilha';
import DiscountScraper from './Discount';
import HapoalimScraper from './Hapoalim';
import { type Scraper, type ScraperCredentials, type ScraperOptions } from './Interface';
import IsracardScraper from './Isracard';
import LeumiScraper from './Leumi';
import MassadScraper from './Massad';
import MaxScraper from './Max';
import MercantileScraper from './Mercantile';
import MizrahiScraper from './Mizrahi';
import OneZeroScraper from './OneZero';
import OtsarHahayalScraper from './OtsarHahayal';
import PagiScraper from './Pagi';
import UnionBankScraper from './UnionBank';
import VisaCalScraper from './VisaCal';
import YahavScraper from './Yahav';

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
  [CompanyTypes.Union]: o => new UnionBankScraper(o),
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
  throw new Error(`unknown company id ${options.companyId}`);
}
