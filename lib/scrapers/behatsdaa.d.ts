import { BaseScraperWithBrowser, type LoginOptions } from './base-scraper-with-browser';
import { type ScraperScrapingResult } from './interface';
type ScraperSpecificCredentials = {
    id: string;
    password: string;
};
declare class BehatsdaaScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions;
    fetchData(): Promise<ScraperScrapingResult>;
}
export default BehatsdaaScraper;
