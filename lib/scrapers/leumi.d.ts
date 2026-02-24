import { BaseScraperWithBrowser } from './base-scraper-with-browser';
import { type ScraperScrapingResult } from './interface';
type ScraperSpecificCredentials = {
    username: string;
    password: string;
};
declare class LeumiScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    getLoginOptions(credentials: ScraperSpecificCredentials): {
        loginUrl: string;
        fields: {
            selector: string;
            value: string;
        }[];
        submitButtonSelector: string;
        checkReadiness: () => Promise<void>;
        postAction: () => Promise<void>;
        possibleResults: import("./base-scraper-with-browser").PossibleLoginResults;
    };
    fetchData(): Promise<ScraperScrapingResult>;
}
export default LeumiScraper;
