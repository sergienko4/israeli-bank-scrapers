import { CompanyTypes } from '../../Definitions';
import { type Scraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface';
import { ScraperWebsiteChangedError } from '../Base/ScraperWebsiteChangedError';
import {
  AmexScraper,
  BehatsdaaScraper,
  BeinleumiScraper,
  BeyahadBishvilhaScraper,
  DiscountScraper,
  HapoalimScraper,
  IsracardScraper,
  LeumiScraper,
  MassadScraper,
  MaxScraper,
  MercantileScraper,
  MizrahiScraper,
  OneZeroScraper,
  OtsarHahayalScraper,
  PagiScraper,
  VisaCalScraper,
  YahavScraper,
} from './AllScrapers';

type ScraperFactory = (options: ScraperOptions) => Scraper<ScraperCredentials>;

const SCRAPER_REGISTRY: Partial<Record<CompanyTypes, ScraperFactory>> = {
  [CompanyTypes.Hapoalim]:
    /**
     * Creates a HapoalimScraper for the given options.
     * @param o - scraper options
     * @returns a HapoalimScraper instance
     */
    o => new HapoalimScraper(o),
  [CompanyTypes.Leumi]:
    /**
     * Creates a LeumiScraper for the given options.
     * @param o - scraper options
     * @returns a LeumiScraper instance
     */
    o => new LeumiScraper(o),
  [CompanyTypes.BeyahadBishvilha]:
    /**
     * Creates a BeyahadBishvilhaScraper for the given options.
     * @param o - scraper options
     * @returns a BeyahadBishvilhaScraper instance
     */
    o => new BeyahadBishvilhaScraper(o),
  [CompanyTypes.Mizrahi]:
    /**
     * Creates a MizrahiScraper for the given options.
     * @param o - scraper options
     * @returns a MizrahiScraper instance
     */
    o => new MizrahiScraper(o),
  [CompanyTypes.Discount]:
    /**
     * Creates a DiscountScraper for the given options.
     * @param o - scraper options
     * @returns a DiscountScraper instance
     */
    o => new DiscountScraper(o),
  [CompanyTypes.Mercantile]:
    /**
     * Creates a MercantileScraper for the given options.
     * @param o - scraper options
     * @returns a MercantileScraper instance
     */
    o => new MercantileScraper(o),
  [CompanyTypes.OtsarHahayal]:
    /**
     * Creates an OtsarHahayalScraper for the given options.
     * @param o - scraper options
     * @returns an OtsarHahayalScraper instance
     */
    o => new OtsarHahayalScraper(o),
  [CompanyTypes.VisaCal]:
    /**
     * Creates a VisaCalScraper for the given options.
     * @param o - scraper options
     * @returns a VisaCalScraper instance
     */
    o => new VisaCalScraper(o),
  [CompanyTypes.Max]:
    /**
     * Creates a MaxScraper for the given options.
     * @param o - scraper options
     * @returns a MaxScraper instance
     */
    o => new MaxScraper(o),
  [CompanyTypes.Isracard]:
    /**
     * Creates an IsracardScraper for the given options.
     * @param o - scraper options
     * @returns an IsracardScraper instance
     */
    o => new IsracardScraper(o),
  [CompanyTypes.Amex]:
    /**
     * Creates an AmexScraper for the given options.
     * @param o - scraper options
     * @returns an AmexScraper instance
     */
    o => new AmexScraper(o),
  [CompanyTypes.Beinleumi]:
    /**
     * Creates a BeinleumiScraper for the given options.
     * @param o - scraper options
     * @returns a BeinleumiScraper instance
     */
    o => new BeinleumiScraper(o),
  [CompanyTypes.Massad]:
    /**
     * Creates a MassadScraper for the given options.
     * @param o - scraper options
     * @returns a MassadScraper instance
     */
    o => new MassadScraper(o),
  [CompanyTypes.Yahav]:
    /**
     * Creates a YahavScraper for the given options.
     * @param o - scraper options
     * @returns a YahavScraper instance
     */
    o => new YahavScraper(o),
  [CompanyTypes.OneZero]:
    /**
     * Creates a OneZeroScraper for the given options.
     * @param o - scraper options
     * @returns a OneZeroScraper instance
     */
    o => new OneZeroScraper(o),
  [CompanyTypes.Behatsdaa]:
    /**
     * Creates a BehatsdaaScraper for the given options.
     * @param o - scraper options
     * @returns a BehatsdaaScraper instance
     */
    o => new BehatsdaaScraper(o),
  [CompanyTypes.Pagi]:
    /**
     * Creates a PagiScraper for the given options.
     * @param o - scraper options
     * @returns a PagiScraper instance
     */
    o => new PagiScraper(o),
};

/**
 * Creates and returns a Scraper instance for the bank identified by options.companyId.
 * Throws ScraperWebsiteChangedError when the company ID is not registered.
 *
 * @param options - scraper options including the companyId that selects the implementation
 * @returns a Scraper instance configured for the requested bank
 */
export default function createScraper(options: ScraperOptions): Scraper<ScraperCredentials> {
  const factory = SCRAPER_REGISTRY[options.companyId];
  if (factory) return factory(options);
  throw new ScraperWebsiteChangedError('Factory', `unknown company id ${options.companyId}`);
}
