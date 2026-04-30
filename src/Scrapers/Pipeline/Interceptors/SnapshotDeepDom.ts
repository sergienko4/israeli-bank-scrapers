/**
 * Deep-DOM serializer — captures page HTML with OPEN shadow roots and
 * INLINED stylesheet text so the static snapshot renders with the same
 * CSS layout as the live page.
 *
 * The serializer body is a plain JS string passed to `page.evaluate(js)`.
 * This is intentional: passing a TypeScript function would be transpiled
 * by tsx/esbuild, which wraps function declarations with `__name(...)`.
 * That helper lives in Node scope and is not defined in the browser,
 * causing the evaluate to throw `__name is not defined`. A plain string
 * is sent as-is — no transpilation, no __name.
 *
 * Two fidelity features produced by the serializer:
 *   1. Shadow roots as `<template shadowrootmode="open">`
 *   2. Same-origin stylesheets inlined into `<style data-inlined-recorder>`
 */

import type { Page } from 'playwright-core';

/** Serialised HTML string returned by captureDeepHtml. */
type CapturedHtml = string;

/** Empty-string fallback when deep serialization fails in the page context. */
const EMPTY_HTML: CapturedHtml = '';

/** Serializer — runs inside the browser. Plain JS string (see module JSDoc). */
const SERIALIZE_JS = `(function(){
  function readSheet(sheet){
    try {
      var rules = sheet.cssRules;
      if (!rules) return '';
      var out = [];
      for (var i = 0; i < rules.length; i++) out.push(rules[i].cssText || '');
      return out.join('\\n');
    } catch (_e) { return ''; }
  }
  function collectAllStyleText(){
    var sheets = Array.prototype.slice.call(document.styleSheets);
    var parts = [];
    for (var i = 0; i < sheets.length; i++){
      var t = readSheet(sheets[i]);
      if (t) parts.push(t);
    }
    return parts.join('\\n');
  }
  function cloneWithShadow(node){
    if (node.nodeType !== 1) return node.cloneNode(true);
    var clone = node.cloneNode(false);
    var sr = node.shadowRoot;
    if (sr){
      var tpl = document.createElement('template');
      tpl.setAttribute('shadowrootmode', 'open');
      var srKids = Array.prototype.slice.call(sr.childNodes);
      for (var i = 0; i < srKids.length; i++) tpl.content.appendChild(cloneWithShadow(srKids[i]));
      clone.appendChild(tpl);
    }
    var kids = Array.prototype.slice.call(node.childNodes);
    for (var j = 0; j < kids.length; j++) clone.appendChild(cloneWithShadow(kids[j]));
    return clone;
  }
  function injectStyle(root, cssText){
    var head = root.querySelector('head');
    if (!head) return;
    var style = document.createElement('style');
    style.setAttribute('data-inlined-recorder', '1');
    style.setAttribute('data-inlined-size', String(cssText.length));
    style.textContent = cssText;
    head.insertBefore(style, head.firstChild);
  }
  try {
    var css = collectAllStyleText();
    var clone = cloneWithShadow(document.documentElement);
    injectStyle(clone, css);
    return '<!DOCTYPE html>' + clone.outerHTML;
  } catch (_e) { return ''; }
})()`;

/**
 * Read the current page via page.content() as a fallback when evaluate fails.
 * @param page - Playwright Page to read from.
 * @returns HTML string or empty string if page.content() throws.
 */
async function fallbackHtml(page: Page): Promise<CapturedHtml> {
  try {
    return await page.content();
  } catch {
    return EMPTY_HTML;
  }
}

/**
 * Safe evaluate wrapper — returns '' on any Playwright/browser throw.
 * @param page - Playwright Page.
 * @returns Serialised HTML string or '' on error.
 */
async function tryEvaluate(page: Page): Promise<CapturedHtml> {
  return page.evaluate<CapturedHtml>(SERIALIZE_JS).catch((): CapturedHtml => EMPTY_HTML);
}

/**
 * Capture full page HTML with open shadow roots and inlined CSS.
 * Falls back to `page.content()` only on total evaluate failure.
 * @param page - Playwright Page to serialize.
 * @returns HTML string, empty on total failure.
 */
async function captureDeepHtml(page: Page): Promise<CapturedHtml> {
  const html = await tryEvaluate(page);
  if (html) return html;
  return fallbackHtml(page);
}

export { captureDeepHtml };
export default captureDeepHtml;
