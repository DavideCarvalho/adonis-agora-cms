import { createHmac, timingSafeEqual } from 'node:crypto';

export type PreviewClaims = {
  collection: string;
  documentId: string;
  userId: string | null;
  /** Tenant the token was issued for; never read from the request. */
  tenant: string | null;
  /** Unix ms. */
  exp: number;
};

/**
 * Short-lived, signed preview token.
 *
 * HMAC-SHA256 over the claims, base64url encoded. No database, no session: the site verifies it
 * with the same secret, so a preview URL cannot be replayed after `ttl` and cannot be forged.
 */
export function signPreviewToken(claims: PreviewClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyPreviewToken(
  token: string,
  secret: string,
  now = Date.now(),
): PreviewClaims | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = signatureFor(payload, secret);
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(provided, expectedBuffer)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PreviewClaims;
    if (!claims.collection || !claims.documentId) return null;
    if (claims.exp <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

export function previewUrl(baseUrl: string, token: string): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}

function signature(payload: string, secret: string): string {
  return signatureFor(payload, secret);
}

function signatureFor(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}
