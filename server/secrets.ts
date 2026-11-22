import crypto from 'node:crypto';

/** AES-256-GCM sealing for tokens stored inside the workspace document. Needs SECRETS_KEY (any long random string). */
function key(): Buffer | null {
  const k = process.env.SECRETS_KEY;
  return k && k.length >= 16 ? crypto.createHash('sha256').update(k).digest() : null;
}

export const secretsConfigured = () => key() !== null;

export function seal(plain: string): string | null {
  const k = key();
  if (!k) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function unseal(sealed: string | undefined): string | null {
  const k = key();
  if (!k || !sealed) return null;
  try {
    const [v, iv, tag, ct] = sealed.split(':');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** HMAC helper for signed state values and per-organization tool tokens. */
export function hmacHex(data: string, purpose: string): string | null {
  const k = key();
  return k ? crypto.createHmac('sha256', k).update(`${purpose}:${data}`).digest('hex') : null;
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
