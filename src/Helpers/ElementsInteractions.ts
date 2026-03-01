import { type Frame, type Page } from 'playwright';

import { humanDelay, waitUntil } from './Waiting';

export interface WaitOptions {
  visible?: boolean;
  timeout?: number;
}

export interface PageEvalOpts<R> {
  selector: string;
  defaultResult: R;
  callback: (element: Element, ...args: unknown[]) => R;
}

export interface PageEvalAllOpts<R> {
  selector: string;
  defaultResult: R;
  callback: (elements: Element[], ...args: unknown[]) => R;
}

async function waitUntilElementFound(
  page: Page | Frame,
  elementSelector: string,
  opts: WaitOptions = {},
): Promise<void> {
  const state = opts.visible ? 'visible' : 'attached';
  await page.waitForSelector(elementSelector, { state, timeout: opts.timeout });
}

async function waitUntilElementDisappear(
  page: Page,
  elementSelector: string,
  timeout?: number,
): Promise<void> {
  await page.waitForSelector(elementSelector, { state: 'hidden', timeout });
}

async function waitForIframe(
  page: Page,
  framePredicate: (frame: Frame) => boolean,
  timeout: number,
): Promise<Frame | undefined> {
  let frame: Frame | undefined;
  await waitUntil(
    () => {
      frame = page.frames().find(framePredicate);
      return Promise.resolve(!!frame);
    },
    'waiting for iframe',
    { timeout, interval: 1000 },
  );
  return frame;
}

async function waitUntilIframeFound(
  page: Page,
  framePredicate: (frame: Frame) => boolean,
  opts: WaitOptions & { description?: string } = {},
): Promise<Frame> {
  const { timeout = 30000, description = '' } = opts;
  const frame = await waitForIframe(page, framePredicate, timeout);

  if (!frame) {
    throw new Error(`failed to find iframe: ${description}`);
  }

  return frame;
}

async function fillInput(
  pageOrFrame: Page | Frame,
  inputSelector: string,
  inputValue: string,
): Promise<void> {
  await humanDelay(200, 600);
  await pageOrFrame.$eval(inputSelector, (input: Element) => {
    const inputElement = input;
    // @ts-ignore
    inputElement.value = '';
  });
  await pageOrFrame
    .locator(inputSelector)
    .pressSequentially(inputValue, { delay: 50 + Math.random() * 100 });
}

async function setValue(
  pageOrFrame: Page | Frame,
  inputSelector: string,
  inputValue: string,
): Promise<void> {
  await pageOrFrame.$eval(
    inputSelector,
    (input: Element, value) => {
      const inputElement = input;
      // @ts-ignore
      inputElement.value = value;
    },
    [inputValue],
  );
}

async function clickButton(page: Page | Frame, buttonSelector: string): Promise<void> {
  await humanDelay(200, 800);
  await page.$eval(buttonSelector, el => {
    (el as HTMLElement).click();
  });
}

async function clickLink(page: Page, aSelector: string): Promise<void> {
  await page.$eval(aSelector, (el: Element) => {
    (el as HTMLElement).click();
  });
}

async function pageEvalAll<R>(page: Page | Frame, opts: PageEvalAllOpts<R>): Promise<R> {
  const { selector, defaultResult, callback } = opts;
  let result = defaultResult;
  try {
    await page.waitForFunction(() => document.readyState === 'complete');
    result = await page.$$eval(selector, callback);
  } catch (e) {
    // Swallow "no elements found" errors and return the default result instead.
    if (!(e as Error).message.startsWith('Error: failed to find elements matching selector')) {
      throw e;
    }
  }

  return result;
}

async function pageEval<R>(page: Page | Frame, opts: PageEvalOpts<R>): Promise<R> {
  const { selector, defaultResult, callback } = opts;
  let result = defaultResult;
  try {
    await page.waitForFunction(() => document.readyState === 'complete');
    result = await page.$eval(selector, callback);
  } catch (e) {
    // Swallow "no elements found" errors and return the default result instead.
    if (!(e as Error).message.startsWith('Error: failed to find element matching selector')) {
      throw e;
    }
  }

  return result;
}

async function elementPresentOnPage(pageOrFrame: Page | Frame, selector: string): Promise<boolean> {
  return (await pageOrFrame.$(selector)) !== null;
}

async function dropdownSelect(page: Page, selectSelector: string, value: string): Promise<void> {
  await page.selectOption(selectSelector, value);
}

async function dropdownElements(
  page: Page,
  selector: string,
): Promise<{ name: string; value: string }[]> {
  const options = await page.evaluate(optionSelector => {
    return Array.from(document.querySelectorAll<HTMLOptionElement>(optionSelector))
      .filter(o => o.value)
      .map(o => {
        return {
          name: o.text,
          value: o.value,
        };
      });
  }, `${selector} > option`);
  return options;
}

export {
  clickButton,
  clickLink,
  dropdownElements,
  dropdownSelect,
  elementPresentOnPage,
  fillInput,
  pageEval,
  pageEvalAll,
  setValue,
  waitUntilElementDisappear,
  waitUntilElementFound,
  waitUntilIframeFound,
};
