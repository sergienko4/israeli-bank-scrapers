import IsracardAmexBaseScraper from './base-isracard-amex';
import { type ScraperOptions } from './interface';
declare class IsracardScraper extends IsracardAmexBaseScraper {
    constructor(options: ScraperOptions);
}
export default IsracardScraper;
