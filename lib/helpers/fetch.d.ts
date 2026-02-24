import { type Page } from 'puppeteer';
export declare function fetchGet<TResult>(url: string, extraHeaders: Record<string, any>): Promise<TResult>;
export declare function fetchPost<TResult = any>(url: string, data: Record<string, any>, extraHeaders?: Record<string, any>): Promise<TResult>;
export declare function fetchGraphql<TResult>(url: string, query: string, variables?: Record<string, unknown>, extraHeaders?: Record<string, any>): Promise<TResult>;
export declare function fetchGetWithinPage<TResult>(page: Page, url: string, ignoreErrors?: boolean): Promise<TResult | null>;
export declare function fetchPostWithinPage<TResult>(page: Page, url: string, data: Record<string, any>, extraHeaders?: Record<string, any>, ignoreErrors?: boolean): Promise<TResult | null>;
