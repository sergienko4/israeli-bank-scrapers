/**
 * WK URL vocabulary — a URL group name or the branded inline-URL alternative.
 * Defined in Types so capability ports such as `ITokenBus` do not depend on the
 * Registry; the WK registry re-exports it.
 *
 * <p>The group contract is open: a bank may register any group whose shape the
 * builder rules accept, without editing a shared union. `WKUrlGroup` is the
 * branded key used inside the registry after registration.
 */

import type { Brand } from '../Brand.js';

/**
 * A WK URL group name. The contract is open: the builder rules validate the
 * shape and the registry brands the stored key. The soft brand keeps the name
 * distinct in signatures while still accepting config literals.
 */
type WKUrlGroup = string & { readonly __wkUrlGroup?: 'WKUrlGroup' };

/** Branded inline absolute URL for a urlTag. */
type LiteralUrl = Brand<string, 'WkLiteralUrl'>;

/** A urlTag: a registered WK group or an inline absolute URL. */
type WKUrlOrLiteral = WKUrlGroup | LiteralUrl;

export type { LiteralUrl, WKUrlGroup, WKUrlOrLiteral };
