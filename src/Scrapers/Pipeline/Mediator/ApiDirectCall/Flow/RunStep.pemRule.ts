/**
 * The `pemCertificate` extract rule. The slot text must hold exactly one
 * PEM block, a CERTIFICATE that parses as X.509, certifies the private key the
 * rule's `keyRef` resolves to in the step's scope, and is valid now. The check
 * answers yes or no only; it never echoes the PEM text.
 */

import { createPrivateKey, X509Certificate } from 'node:crypto';

import type { IExtractRule } from '../ConfigContracts/index.js';
import { type ITemplateScope, resolveRefText } from '../Template/RefResolver.js';

const PEM_BEGIN = '-----BEGIN ';
const CERT_BEGIN = '-----BEGIN CERTIFICATE-----';

/** What the rule reads beside the text: the step's scope. */
interface IPemRuleContext {
  readonly scope: ITemplateScope;
}

/**
 * Whether the text holds exactly one PEM block, and it is a certificate.
 * @param text - Slot text.
 * @returns True for one CERTIFICATE block and no other block.
 */
function isSingleCertBlock(text: string): boolean {
  const blocks = text.split(PEM_BEGIN).length - 1;
  return blocks === 1 && text.includes(CERT_BEGIN);
}

/**
 * Parse the certificate.
 * @param text - Slot text.
 * @returns The certificate, or false when it does not parse.
 */
function parsedCert(text: string): X509Certificate | false {
  try {
    return new X509Certificate(text);
  } catch {
    return false;
  }
}

/**
 * Whether the certificate certifies the key.
 * @param cert - Parsed certificate.
 * @param keyPem - PEM private key.
 * @returns True when the key parses and matches the certificate.
 */
function isCertifying(cert: X509Certificate, keyPem: string): boolean {
  try {
    const key = createPrivateKey(keyPem);
    return cert.checkPrivateKey(key);
  } catch {
    return false;
  }
}

/**
 * Whether the certificate is valid now.
 * @param cert - Parsed certificate.
 * @returns True when `validFrom ≤ now ≤ validTo`.
 */
function isCurrent(cert: X509Certificate): boolean {
  const now = Date.now();
  return cert.validFromDate.getTime() <= now && now <= cert.validToDate.getTime();
}

/**
 * Whether the text passes the rule's certificate check.
 * @param text - Transformed slot text.
 * @param rule - Extract rule.
 * @param context - Rule pass context holding the step's scope.
 * @returns True when `pemCertificate` is unset or the certificate is sound.
 */
function isPemCertificate(text: string, rule: IExtractRule, context: IPemRuleContext): boolean {
  if (rule.pemCertificate === undefined) return true;
  if (!isSingleCertBlock(text)) return false;
  const cert = parsedCert(text);
  const keyPem = resolveRefText(rule.pemCertificate.keyRef, context.scope);
  if (cert === false || keyPem === false) return false;
  return isCurrent(cert) && isCertifying(cert, keyPem);
}

export default isPemCertificate;
export { isPemCertificate };
