import { BaseScraper } from './base-scraper';
import { type ScraperGetLongTermTwoFactorTokenResult, type ScraperLoginResult, type ScraperScrapingResult, type ScraperTwoFactorAuthTriggerResult } from './interface';
export type Category = {
    categoryId: number;
    dataSource: string;
    subCategoryId?: number | null;
};
export type Recurrence = {
    dataSource: string;
    isRecurrent: boolean;
};
type ScraperSpecificCredentials = {
    email: string;
    password: string;
} & ({
    otpCodeRetriever: () => Promise<string>;
    phoneNumber: string;
} | {
    otpLongTermToken: string;
});
export default class OneZeroScraper extends BaseScraper<ScraperSpecificCredentials> {
    private otpContext?;
    private accessToken?;
    triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult>;
    getLongTermTwoFactorToken(otpCode: string): Promise<ScraperGetLongTermTwoFactorTokenResult>;
    private resolveOtpToken;
    login(credentials: ScraperSpecificCredentials): Promise<ScraperLoginResult>;
    private fetchPortfolioMovements;
    /**
     * one zero hebrew strings are reversed with a unicode control character that forces display in LTR order
     * We need to remove the unicode control character, and then reverse hebrew substrings inside the string
     */
    private sanitizeHebrew;
    fetchData(): Promise<ScraperScrapingResult>;
}
export {};
