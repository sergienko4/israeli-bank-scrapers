import { type Frame, type Page, type WaitForOptions } from 'puppeteer';
export declare function waitForNavigation(pageOrFrame: Page | Frame, options?: WaitForOptions): Promise<void>;
export declare function waitForNavigationAndDomLoad(page: Page): Promise<void>;
export declare function getCurrentUrl(pageOrFrame: Page | Frame, clientSide?: boolean): string | Promise<string>;
export declare function waitForRedirect(pageOrFrame: Page | Frame, timeout?: number, clientSide?: boolean, ignoreList?: string[]): Promise<void>;
export declare function waitForUrl(pageOrFrame: Page | Frame, url: string | RegExp, timeout?: number, clientSide?: boolean): Promise<void>;
