import { type Page } from 'puppeteer';
/**
 * Apply full anti-detection suite to hide headless Chrome from WAFs.
 * Call BEFORE any navigation — overrides run on every new page load.
 */
export declare function applyAntiDetection(page: Page): Promise<void>;
/**
 * Check if a URL matches known bot detection scripts.
 */
export declare function isBotDetectionScript(url: string): boolean;
/**
 * @deprecated Use applyAntiDetection() instead.
 */
export declare function maskHeadlessUserAgent(page: Page): Promise<void>;
/**
 * Priorities for request interception.
 */
export declare const interceptionPriorities: {
    abort: number;
    continue: number;
};
