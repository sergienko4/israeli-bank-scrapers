import { BaseScraperWithBrowser, type PossibleLoginResults } from './base-scraper-with-browser';
import { type ScraperScrapingResult } from './interface';
type ScraperSpecificCredentials = {
    id: string;
    password: string;
    num: string;
};
declare class DiscountScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    getLoginOptions(credentials: ScraperSpecificCredentials): {
        loginUrl: string;
        checkReadiness: () => Promise<void>;
        fields: {
            selector: string;
            value: string;
        }[];
        submitButtonSelector: string;
        postAction: () => Promise<void>;
        possibleResults: PossibleLoginResults;
    };
    fetchData(): Promise<ScraperScrapingResult>;
}
export default DiscountScraper;
