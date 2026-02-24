import { type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, type PossibleLoginResults } from './base-scraper-with-browser';
type ScraperSpecificCredentials = {
    username: string;
    password: string;
    nationalID: string;
};
declare class YahavScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    getLoginOptions(credentials: ScraperSpecificCredentials): {
        loginUrl: string;
        fields: {
            selector: string;
            value: string;
        }[];
        submitButtonSelector: string;
        checkReadiness: () => Promise<void>;
        postAction: () => Promise<void>;
        possibleResults: PossibleLoginResults;
    };
    fetchData(): Promise<{
        success: boolean;
        accounts: TransactionsAccount[];
    }>;
}
export default YahavScraper;
