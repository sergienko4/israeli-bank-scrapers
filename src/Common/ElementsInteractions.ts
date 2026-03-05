import { type Frame, type Page } from 'playwright';

import type { PageEvalAllOpts } from '../Interfaces/Common/PageEvalAllOpts';
import type { PageEvalOpts } from '../Interfaces/Common/PageEvalOpts';
import type { WaitOptions } from '../Interfaces/Common/WaitOptions';
import { ScraperWebsiteChangedError } from '../Scrapers/Base/ScraperWebsiteChangedError';
import { getDebug } from './Debug';
import { humanDelay, waitUntil } from './Waiting';

export type { PageEvalAllOpts } from '../Interfaces/Common/PageEvalAllOpts';
export type { PageEvalOpts } from '../Interfaces/Common/PageEvalOpts';
export type { WaitOptions } from '../Interfaces/Common/WaitOptions';

const LOG = getDebug('elements');

export async function capturePageText(pageOrFrame: Page | Frame): Promise<string> {
  return pageOrFrame
    .evaluate((): string => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400))
    .catch(() => '(context unavailable)');
}

async function captureElementHtml(pageOrFrame: Page | Frame, selector: string): Promise<string> {
  return pageOrFrame
    .evaluate(
      (sel: string): string => document.querySelector(sel)?.outerHTML.slice(0, 300) ?? '—',
      selector,
    )
    .catch(() => '(context unavailable)');
}

async function waitUntilElementFound(
  page: Page | Frame,
  elementSelector: string,
  opts: WaitOptions = {},
): Promise<void> {
  const state = opts.visible ? 'visible' : 'attached';
  const startMs = Date.now();
  try {
    await page.waitForSelector(elementSelector, { state, timeout: opts.timeout });
    LOG.info('waitForSelector %s → found (%dms)', elementSelector, Date.now() - startMs);
    LOG.info('element html: %s', await captureElementHtml(page, elementSelector));
  } catch (e) {
    LOG.info('waitForSelector %s → TIMEOUT (%dms)', elementSelector, Date.now() - startMs);
    LOG.info('page text: %s', await capturePageText(page));
    throw e;
  }
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
    throw new ScraperWebsiteChangedError(
      'ElementsInteractions',
      `failed to find iframe: ${description}`,
    );
  }

  return frame;
}

async function fillInput(
  pageOrFrame: Page | Frame,
  inputSelector: string,
  inputValue: string,
): Promise<void> {
  LOG.info('fill %s', inputSelector);
  await humanDelay(200, 600);
  await pageOrFrame.$eval(inputSelector, (input: Element) => {
    const inputElement = input;
    // @ts-expect-error -- setting value directly on input element
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
      // @ts-expect-error -- setting value directly on input element
      inputElement.value = value;
    },
    [inputValue],
  );
}

async function clickButton(page: Page | Frame, buttonSelector: string): Promise<void> {
  LOG.info('click %s', buttonSelector);
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

async function pageEvalAll<TResult>(
  page: Page | Frame,
  opts: PageEvalAllOpts<TResult>,
): Promise<TResult> {
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

async function pageEval<TResult>(
  page: Page | Frame,
  opts: PageEvalOpts<TResult>,
): Promise<TResult> {
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
