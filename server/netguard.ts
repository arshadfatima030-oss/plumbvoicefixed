import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/** True for loopback, private, link-local, CGNAT, documentation, multicast and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) {
      const rest = v.slice(7);
      if (rest.includes('.')) return isPrivateIp(rest);
      const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest); // URL() normalises ::ffff:1.2.3.4 to hex form
      if (!m) return true;
      const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return (
      v.startsWith('fc') || v.startsWith('fd') ||
      v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') ||
      v.startsWith('fec') || v.startsWith('fed') || v.startsWith('fee') || v.startsWith('fef') ||
      v.startsWith('2001:db8') || v.startsWith('64:ff9b') || v.startsWith('ff')
    );
  }
  return true;
}

/** Throws unless the URL is http(s) and every resolved address is public (early, friendly SSRF check). */
export async function assertPublicHttpUrl(raw: string, opts: {httpsOnly?: boolean} = {}): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Enter a valid URL.');
  }
  if (u.protocol !== 'https:' && (opts.httpsOnly || u.protocol !== 'http:')) throw new Error(opts.httpsOnly ? 'Only https URLs are allowed.' : 'Only http(s) URLs are allowed.');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Private addresses are not allowed.');
  const addrs = net.isIP(host) ? [{address: host}] : await dns.lookup(host, {all: true});
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Private addresses are not allowed.');
  return u;
}

/**
 * DNS lookup used for the real connection. Validating a hostname and then letting fetch() resolve it again
 * leaves a gap (DNS rebinding: public IP at check time, 127.0.0.1 / 169.254.169.254 at connect time).
 * Here the address that is checked is the very address the socket connects to.
 */
export const guardedLookup = ((hostname: string, options: any, cb: any) => {
  const opts = typeof options === 'function' ? {} : options ?? {};
  const done = typeof options === 'function' ? options : cb;
  dns.lookup(hostname, {all: true, family: opts.family, hints: opts.hints}).then(
    (addrs) => {
      if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
        done(Object.assign(new Error('Private addresses are not allowed.'), {code: 'EPRIVATE'}), opts.all ? [] : '', 0);
      } else if (opts.all) done(null, addrs);
      else done(null, addrs[0].address, addrs[0].family);
    },
    (err) => done(err, opts.all ? [] : '', 0)
  );
}) as net.LookupFunction;

export interface SafeResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/**
 * HTTP(S) request that never follows redirects, caps the body size and refuses private addresses at connect time.
 * Callers still do their own redirect handling and call assertPublicHttpUrl on each hop for clear error messages.
 */
export function safeRequest(
  u: URL,
  opts: {method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number} = {}
): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const headers = {...(opts.headers ?? {})};
  if (opts.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(opts.body));
  return new Promise<SafeResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {method: opts.method ?? 'GET', headers, lookup: guardedLookup, signal: AbortSignal.timeout(timeoutMs), agent: false},
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const out = () => finish(() => resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).subarray(0, maxBytes)}));
        res.on('data', (c: Buffer) => {
          chunks.push(c);
          size += c.length;
          if (size >= maxBytes) {
            out();
            res.destroy();
          }
        });
        res.on('end', out);
        res.on('close', out);
        res.on('error', (e) => finish(() => reject(e)));
      }
    );
    req.on('error', (e) => finish(() => reject(e)));
    req.end(opts.body);
  });
}

/**
 * Opens a GET without buffering the body: resolves as soon as the response headers arrive and hands back the live stream.
 * Same protections as safeRequest (no redirects followed, private addresses refused at connect time, timeout), so the
 * caller can pipe a large file to a client with its own byte cap instead of holding it in memory.
 */
export function safeOpen(
  u: URL,
  opts: {headers?: Record<string, string>; timeoutMs?: number} = {}
): Promise<{status: number; headers: http.IncomingHttpHeaders; stream: http.IncomingMessage; abort: () => void}> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const ac = new AbortController();
    // Covers connect + headers; once streaming starts the caller's own idle/size limits apply.
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000);
    const req = mod.request(u, {method: 'GET', headers: opts.headers ?? {}, lookup: guardedLookup, signal: ac.signal, agent: false}, (res) => {
      clearTimeout(timer);
      resolve({status: res.statusCode ?? 0, headers: res.headers, stream: res, abort: () => req.destroy()});
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end();
  });
}
