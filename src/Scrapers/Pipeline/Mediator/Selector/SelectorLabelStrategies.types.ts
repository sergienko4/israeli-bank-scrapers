/**
 * Shared types and brand declarations for the SelectorLabelStrategies cluster.
 */

import type { Frame, Page } from 'playwright-core';

import type { Brand } from '../../Types/Brand.js';

/** XPath selector for div/span strict text-content match. */
type DivSpanStrictXpath = Brand<string, 'DivSpanStrictXpath'>;

/** A function that checks element existence with a timeout. */
type QueryFn = (context: Page | Frame, css: string) => Promise<boolean>;

/** Nullable string result from DOM attribute lookups — matches Playwright ElementHandle API. */
type NullableAttrResult = Promise<string | null>;

/** A DOM element handle that supports getting attribute values. */
interface ILabelHandle {
  /** Retrieve an HTML attribute by name. */
  getAttribute: (name: string) => NullableAttrResult;
}

/** Extracted element metadata — shared by fillable and clickable checks. */
interface IElementMeta {
  readonly tag: string;
  readonly type: string;
  readonly role: string;
  readonly tabindex: string;
}

/** Options for xpath-based input resolution strategies. */
interface IXpathStrategyOpts {
  ctx: Page | Frame;
  baseXpath: string;
  queryFn: QueryFn;
}

/** Options for aria-based input resolution. */
interface IAriaRefOpts {
  ctx: Page | Frame;
  label: ILabelHandle;
  labelValue: string;
  queryFn: QueryFn;
}

/** Inputs for label-based input resolution strategies. */
interface ILabelStrategyOpts {
  ctx: Page | Frame;
  label: ILabelHandle;
  baseXpath: string;
  labelValue: string;
  queryFn: QueryFn;
}

/** Bundle of inputs for the shared fillable-probe helper. */
interface IProbeFillableOpts {
  readonly ctx: Page | Frame;
  readonly xpath: string;
  readonly queryFn: QueryFn;
  readonly fieldTag: string;
}

/** Options for an ancestor probe action. */
interface IAncestorProbeOpts {
  ctx: Page | Frame;
  textValue: string;
  queryFn: QueryFn;
}

/** Options for resolving a labelText candidate. */
interface IResolveLabelTextOpts {
  ctx: Page | Frame;
  labelXpath: string;
  labelValue: string;
  queryFn: QueryFn;
}
export type {
  DivSpanStrictXpath,
  IAncestorProbeOpts,
  IAriaRefOpts,
  IElementMeta,
  ILabelHandle,
  ILabelStrategyOpts,
  IProbeFillableOpts,
  IResolveLabelTextOpts,
  IXpathStrategyOpts,
  NullableAttrResult,
  QueryFn,
};
