import { BaseScraperWithBrowser, type LoginOptions } from './base-scraper-with-browser';
import { type ScraperScrapingResult } from './interface';
type ScraperSpecificCredentials = {
    username: string;
    password: string;
};
declare class VisaCalScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    private authorization;
    private authRequestPromise;
    openLoginPopup: () => Promise<never>;
    getCards(): Promise<{
        cardUniqueId: string;
        last4Digits: string;
    }[]>;
    getAuthorizationHeader(): Promise<string>;
    getXSiteId(): Promise<string>;
    getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions;
    fetchData(): Promise<ScraperScrapingResult>;
}
export default VisaCalScraper;
