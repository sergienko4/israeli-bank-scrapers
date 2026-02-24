import { type CompanyTypes, ScraperProgressTypes } from '../definitions';
import { type Scraper, type ScraperCredentials, type ScraperGetLongTermTwoFactorTokenResult, type ScraperLoginResult, type ScraperOptions, type ScraperScrapingResult, type ScraperTwoFactorAuthTriggerResult } from './interface';
export declare class BaseScraper<TCredentials extends ScraperCredentials> implements Scraper<TCredentials> {
    options: ScraperOptions;
    private eventEmitter;
    constructor(options: ScraperOptions);
    initialize(): Promise<void>;
    scrape(credentials: TCredentials): Promise<ScraperScrapingResult>;
    triggerTwoFactorAuth(_phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult>;
    getLongTermTwoFactorToken(_otpCode: string): Promise<ScraperGetLongTermTwoFactorTokenResult>;
    protected login(_credentials: TCredentials): Promise<ScraperLoginResult>;
    protected fetchData(): Promise<ScraperScrapingResult>;
    protected terminate(_success: boolean): Promise<void>;
    protected emitProgress(type: ScraperProgressTypes): void;
    protected emit(eventName: string, payload: Record<string, any>): void;
    onProgress(func: (companyId: CompanyTypes, payload: {
        type: ScraperProgressTypes;
    }) => void): void;
}
