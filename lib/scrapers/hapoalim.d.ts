import { type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, type PossibleLoginResults } from './base-scraper-with-browser';
type ScraperSpecificCredentials = {
    userCode: string;
    password: string;
};
declare class HapoalimScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    get baseUrl(): string;
    getLoginOptions(credentials: ScraperSpecificCredentials): {
        loginUrl: string;
        fields: {
            selector: string;
            value: string;
        }[];
        submitButtonSelector: string;
        postAction: () => Promise<void>;
        possibleResults: PossibleLoginResults;
    };
    fetchData(): Promise<{
        success: boolean;
        accounts: TransactionsAccount[];
    }>;
}
export default HapoalimScraper;
