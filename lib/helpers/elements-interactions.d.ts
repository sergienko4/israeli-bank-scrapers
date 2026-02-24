import { type Frame, type Page } from 'puppeteer';
declare function waitUntilElementFound(page: Page | Frame, elementSelector: string, onlyVisible?: boolean, timeout?: number): Promise<void>;
declare function waitUntilElementDisappear(page: Page, elementSelector: string, timeout?: number): Promise<void>;
declare function waitUntilIframeFound(page: Page, framePredicate: (frame: Frame) => boolean, description?: string, timeout?: number): Promise<Frame>;
declare function fillInput(pageOrFrame: Page | Frame, inputSelector: string, inputValue: string): Promise<void>;
declare function setValue(pageOrFrame: Page | Frame, inputSelector: string, inputValue: string): Promise<void>;
declare function clickButton(page: Page | Frame, buttonSelector: string): Promise<void>;
declare function clickLink(page: Page, aSelector: string): Promise<void>;
declare function pageEvalAll<R>(page: Page | Frame, selector: string, defaultResult: any, callback: (elements: Element[], ...args: any) => R, ...args: any[]): Promise<R>;
declare function pageEval<R>(pageOrFrame: Page | Frame, selector: string, defaultResult: any, callback: (elements: Element, ...args: any) => R, ...args: any[]): Promise<R>;
declare function elementPresentOnPage(pageOrFrame: Page | Frame, selector: string): Promise<boolean>;
declare function dropdownSelect(page: Page, selectSelector: string, value: string): Promise<void>;
declare function dropdownElements(page: Page, selector: string): Promise<{
    name: string;
    value: string;
}[]>;
export { clickButton, clickLink, dropdownElements, dropdownSelect, elementPresentOnPage, fillInput, pageEval, pageEvalAll, setValue, waitUntilElementDisappear, waitUntilElementFound, waitUntilIframeFound, };
