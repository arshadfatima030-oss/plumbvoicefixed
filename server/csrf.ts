/**
 * Cross-site request forgery guard for state-changing /api requests (pure function, so it can be unit tested).
 *
 * Browsers always attach Origin (or at least Referer / Sec-Fetch-Site) to a cross-site POST, so a state-changing
 * request that carries none of them is not coming from a normal browser page. Those are refused, except for the
 * machine-to-machine routes below, which have no browser session and are protected by signatures or secrets instead.
 */
export interface CsrfInput {
  method: string;
  /** Path relative to /api, e.g. "/leads/123". */
  path: string;
  origin?: string;
  referer?: string;
  secFetchSite?: string;
  /** The Host the request was addressed to (host[:port]). */
  host?: string;
  /** Configured public URL of the app (APP_URL), if any. */
  appUrl?: string;
  production: boolean;
}

/** Verified by a provider signature / shared secret, never by a browser cookie. */
/** /tools/ = the AI assistant's callbacks: no cookie, authenticated by the x-plumbvoice-tool-token header. */
const MACHINE_PREFIXES = ['/webhooks/', '/telnyx/texml/', '/cron/', '/tools/'];
/** Public website widget: no cookies, answers with its own per-business CORS allowlist. */
const PUBLIC_WIDGET_PREFIX = '/public/chat/';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type CsrfVerdict = {ok: true} | {ok: false; reason: string};

function parse(u: string | undefined): URL | null {
  if (!u) return null;
  try {
    return new URL(u);
  } catch {
    return null; // includes the literal string "null" that sandboxed / opaque origins send
  }
}

export function csrfVerdict(i: CsrfInput): CsrfVerdict {
  if (SAFE_METHODS.has(i.method.toUpperCase())) return {ok: true};
  if (i.path.startsWith(PUBLIC_WIDGET_PREFIX) || MACHINE_PREFIXES.some((p) => i.path.startsWith(p))) return {ok: true};

  if (i.secFetchSite === 'cross-site') return {ok: false, reason: 'cross-site'};

  const app = i.appUrl && i.appUrl !== 'MY_APP_URL' ? parse(i.appUrl) : null;
  const allowedHosts = new Set<string>();
  if (i.host) allowedHosts.add(i.host.toLowerCase());
  if (app) allowedHosts.add(app.host.toLowerCase());

  const sourceRaw = i.origin !== undefined && i.origin !== '' ? i.origin : i.referer;
  if (sourceRaw === undefined || sourceRaw === '') {
    // No Origin and no Referer: accept only if the browser itself vouches that this is a same-origin request.
    return i.secFetchSite === 'same-origin' ? {ok: true} : {ok: false, reason: 'no origin information'};
  }
  const source = parse(sourceRaw);
  if (!source) return {ok: false, reason: 'unparseable origin'};
  if (source.protocol !== 'https:' && !(source.protocol === 'http:' && !i.production)) return {ok: false, reason: 'insecure origin'};
  if (!allowedHosts.has(source.host.toLowerCase())) return {ok: false, reason: 'origin mismatch'};
  return {ok: true};
}
