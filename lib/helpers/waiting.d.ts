import type { Falsy } from 'utility-types';
export declare class TimeoutError extends Error {
}
export declare const SECOND = 1000;
type WaitUntilReturn<T> = T extends Falsy ? never : Promise<NonNullable<T>>;
/**
 * Wait until a promise resolves with a truthy value or reject after a timeout
 */
export declare function waitUntil<T>(asyncTest: () => Promise<T>, description?: string, timeout?: number, interval?: number): WaitUntilReturn<T>;
export declare function raceTimeout(ms: number, promise: Promise<any>): Promise<any>;
export declare function runSerial<T>(actions: (() => Promise<T>)[]): Promise<T[]>;
export declare function sleep(ms: number): Promise<unknown>;
export {};
