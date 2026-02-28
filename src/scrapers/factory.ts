import { CompanyTypes } from '../definitions';
import AmexScraper from './amex';
import BehatsdaaScraper from './behatsdaa';
import BeinleumiScraper from './beinleumi';
import BeyahadBishvilhaScraper from './beyahad-bishvilha';
import DiscountScraper from './discount';
import HapoalimScraper from './hapoalim';
import { type Scraper, type ScraperCredentials, type ScraperOptions } from './interface';
import IsracardScraper from './isracard';
import LeumiScraper from './leumi';
import MassadScraper from './massad';
import MaxScraper from './max';
import MercantileScraper from './mercantile';
import MizrahiScraper from './mizrahi';
import OneZeroScraper from './one-zero';
import OtsarHahayalScraper from './otsar-hahayal';
import PagiScraper from './pagi';
import UnionBankScraper from './union-bank';
import VisaCalScraper from './visa-cal';
import YahavScraper from './yahav';

type ScraperFactory = (options: ScraperOptions) => Scraper<ScraperCredentials>;

const SCRAPER_REGISTRY: Partial<Record<CompanyTypes, ScraperFactory>> = {
  [CompanyTypes.hapoalim]: o => new HapoalimScraper(o),
  [CompanyTypes.leumi]: o => new LeumiScraper(o),
  [CompanyTypes.beyahadBishvilha]: o => new BeyahadBishvilhaScraper(o),
  [CompanyTypes.mizrahi]: o => new MizrahiScraper(o),
  [CompanyTypes.discount]: o => new DiscountScraper(o),
  [CompanyTypes.mercantile]: o => new MercantileScraper(o),
  [CompanyTypes.otsarHahayal]: o => new OtsarHahayalScraper(o),
  [CompanyTypes.visaCal]: o => new VisaCalScraper(o),
  [CompanyTypes.max]: o => new MaxScraper(o),
  [CompanyTypes.isracard]: o => new IsracardScraper(o),
  [CompanyTypes.amex]: o => new AmexScraper(o),
  [CompanyTypes.union]: o => new UnionBankScraper(o),
  [CompanyTypes.beinleumi]: o => new BeinleumiScraper(o),
  [CompanyTypes.massad]: o => new MassadScraper(o),
  [CompanyTypes.yahav]: o => new YahavScraper(o),
  [CompanyTypes.oneZero]: o => new OneZeroScraper(o),
  [CompanyTypes.behatsdaa]: o => new BehatsdaaScraper(o),
  [CompanyTypes.pagi]: o => new PagiScraper(o),
};

export default function createScraper(options: ScraperOptions): Scraper<ScraperCredentials> {
  const factory = SCRAPER_REGISTRY[options.companyId];
  if (factory) return factory(options);
  throw new Error(`unknown company id ${options.companyId}`);
}
