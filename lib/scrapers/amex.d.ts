import IsracardAmexBaseScraper from './base-isracard-amex';
import { type ScraperOptions } from './interface';
declare class AmexScraper extends IsracardAmexBaseScraper {
    constructor(options: ScraperOptions);
}
export default AmexScraper;
