import {Transform} from 'node:stream';
import type {IncomingHttpHeaders} from 'node:http';
import {assertPublicHttpUrl, safeOpen} from './netguard.ts';

/**
 * Where call recordings may be fetched from. Provider URLs are stored from webhook payloads, so they are treated as
 * untrusted input: https only, host must match this allowlist, and every redirect hop is checked again.
 * Override with RECORDING_HOST_ALLOWLIST="telnyx.com,amazonaws.com" (comma separated; a host matches itself and its subdomains).
 * The defaults are a starting point: confirm them against the URL of one real recording and tighten them if you can.
 */
export const DEFAULT_RECORDING_HOSTS = ['telnyx.com', 'amazonaws.com'];
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const AUDIO_TYPE = /^audio\/(mpeg|mp3|mpeg3|x-mpeg-3|wav|x-wav|wave|ogg|webm|mp4|x-m4a|m4a|aac|flac)$/i;

export function recordingHosts(env: string | undefined = process.env.RECORDING_HOST_ALLOWLIST): string[] {
  const list = (env ?? '').split(',').map((h) => h.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
  return list.length ? list : DEFAULT_RECORDING_HOSTS;
}

/** Returns the parsed URL when it is an acceptable recording location, otherwise null. Pure: no network. */
export function parseRecordingUrl(raw: string, hosts: string[] = recordingHosts()): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const h = u.hostname.toLowerCase();
  return hosts.some((a) => h === a || h.endsWith(`.${a}`)) ? u : null;
}

export class RecordingError extends Error {}

export interface OpenedRecording {
  status: 200 | 206;
  headers: {contentType: string; contentLength?: string; contentRange?: string};
  stream: NodeJS.ReadableStream;
  abort: () => void;
}

/** Only a single, simple byte range is forwarded (that is all <audio> sends when seeking). */
export const safeRange = (v: unknown): string | undefined => (typeof v === 'string' && /^bytes=\d{0,12}-\d{0,12}$/.test(v) && v !== 'bytes=-' ? v : undefined);

export async function openRecording(rawUrl: string, range?: string, hosts: string[] = recordingHosts(), maxBytes: number = MAX_RECORDING_BYTES): Promise<OpenedRecording> {
  const first = parseRecordingUrl(rawUrl, hosts);
  if (!first) throw new RecordingError('Recording location is not allowed.');
  let target: URL = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpUrl(target.href, {httpsOnly: true}); // friendly early check; the socket re-checks at connect time
    const up = await safeOpen(target, {headers: range ? {Range: range} : {}});
    if ([301, 302, 303, 307, 308].includes(up.status)) {
      up.abort();
      const loc = up.headers.location;
      const next: URL | null = typeof loc === 'string' ? parseRecordingUrl(new URL(loc, target).href, hosts) : null;
      if (!next) throw new RecordingError('Recording redirected somewhere that is not allowed.');
      target = next;
      continue;
    }
    if (up.status !== 200 && up.status !== 206) {
      up.abort();
      throw new RecordingError(`Provider answered ${up.status}.`);
    }
    const h: IncomingHttpHeaders = up.headers;
    const contentType = String(h['content-type'] ?? '').split(';')[0].trim();
    if (!AUDIO_TYPE.test(contentType)) {
      up.abort();
      throw new RecordingError('Provider did not return audio.');
    }
    const len = Number(h['content-length'] ?? 0);
    if (len > maxBytes) {
      up.abort();
      throw new RecordingError('Recording is too large.');
    }
    // Enforced while streaming too, because Content-Length can be absent or a lie.
    let sent = 0;
    const cap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        sent += chunk.length;
        if (sent > maxBytes) cb(new RecordingError('Recording exceeded the size limit.'));
        else cb(null, chunk);
      },
    });
    // Aborting (listener left, size cap hit) makes the upstream emit an error; without a listener Node would crash the process.
    // Consumers still receive the error through their own 'error' handlers.
    cap.on('error', () => undefined);
    up.stream.on('error', (e) => cap.destroy(e));
    return {
      status: up.status === 206 ? 206 : 200,
      headers: {
        contentType,
        contentLength: typeof h['content-length'] === 'string' ? h['content-length'] : undefined,
        contentRange: typeof h['content-range'] === 'string' ? h['content-range'] : undefined,
      },
      stream: up.stream.pipe(cap),
      abort: () => up.abort(),
    };
  }
  throw new RecordingError('Too many redirects.');
}
