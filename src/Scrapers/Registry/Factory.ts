import { type BrowserEngineType, getGlobalEngineChain } from '../../Common/BrowserEngine';
import { CompanyTypes } from '../../Definitions';
import { type Scraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface';
import { ScraperWebsiteChangedError } from '../Base/ScraperWebsiteChangedError';
import { ScraperWithFallback } from '../Base/ScraperWithFallback';
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
 * Instantiates the concrete bank scraper for the given companyId without any fallback wrapping.
 * Used internally by createScraper() and ScraperWithFallback.
 *
 * @param options - scraper options including the companyId
 * @returns the concrete Scraper instance for the bank
 */
export function createConcreteScraper(options: ScraperOptions): Scraper<ScraperCredentials> {
  const factory = SCRAPER_REGISTRY[options.companyId];
  if (factory) return factory(options);
  throw new ScraperWebsiteChangedError('Factory', `unknown company id ${options.companyId}`);
}

/**
 * Creates a Scraper that automatically tries all engines in the global chain (Camoufox →
 * PlaywrightStealth → Rebrowser → Patchright) on WafBlocked or Timeout, returning the first
 * successful result. Existing consumers call this exactly as before — no code changes needed.
 *
 * @param options - scraper options including the companyId that selects the implementation
 * @returns a ScraperWithFallback configured for the requested bank
 */
export default function createScraper(options: ScraperOptions): Scraper<ScraperCredentials> {
  if (!SCRAPER_REGISTRY[options.companyId])
    throw new ScraperWebsiteChangedError('Factory', `unknown company id ${options.companyId}`);
  return createScraperWithFallback(options);
}

/**
 * Creates a ScraperWithFallback that tries each engine in order on WafBlocked or Timeout.
 * On success or any other error type the result is returned immediately without fallback.
 *
 * @param options - scraper options including companyId and startDate
 * @param engines - ordered list of engines to try; defaults to getGlobalEngineChain()
 * @returns a ScraperWithFallback instance ready to call .scrape(credentials)
 */
export function createScraperWithFallback(
  options: ScraperOptions,
  engines: BrowserEngineType[] = getGlobalEngineChain(),
): ScraperWithFallback {
  return new ScraperWithFallback(options, createConcreteScraper, engines);
}
