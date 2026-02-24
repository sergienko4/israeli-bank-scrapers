import { type Page } from 'puppeteer';
export declare function getFromSessionStorage<T>(page: Page, key: string): Promise<T | null>;
