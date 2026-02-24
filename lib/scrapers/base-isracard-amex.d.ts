import { type Transaction } from '../transactions';
import { BaseScraperWithBrowser } from './base-scraper-with-browser';
import { type ScraperOptions, type ScraperScrapingResult } from './interface';
type ScraperSpecificCredentials = {
    id: string;
    password: string;
    card6Digits: string;
};
declare class IsracardAmexBaseScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    private baseUrl;
    private companyCode;
    private servicesUrl;
    constructor(options: ScraperOptions, baseUrl: string, companyCode: string);
    login(credentials: ScraperSpecificCredentials): Promise<ScraperScrapingResult>;
    private validateCredentials;
    fetchData(): Promise<{
        success: boolean;
        accounts: {
            accountNumber: string;
            txns: Transaction[];
        }[];
    }>;
}
export default IsracardAmexBaseScraper;
