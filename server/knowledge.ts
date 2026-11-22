import {assertPublicHttpUrl, safeRequest} from './netguard.ts';

export interface KnowledgePreview {
  url: string;
  pagesRead: string[];
  title: string;
  description: string;
  phones: string[];
  emails: string[];
  hours: string[];
  serviceAreas: string[];
  services: string[];
  blockedByRobots: boolean;
}

const UA = 'PlumbVoiceBot/1.0 (+business knowledge import requested by the site owner)';
const MAX_BYTES = 1_500_000;

export function htmlToLines(html: string): string[] {
  const t = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br|ul|ol|table|header|footer)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of t.split('\n')) {
    const l = raw.replace(/\s+/g, ' ').trim();
    if (l.length < 4 || l.length > 240 || seen.has(l)) continue;
    seen.add(l);
    out.push(l);
  }
  return out;
}

const SERVICE_RE = /(plumb|drain|leak|water heater|sewer|pipe|faucet|toilet|repipe|electric|outlet|panel|breaker|wiring|lighting|generator|ev charger|inspection|emergency)/i;

/** Pulls only lines that literally appear on the site; nothing is generated or guessed. */
export function extractFacts(lines: string[]) {
  const text = lines.join('\n');
  const uniq = (a: string[], n: number) => [...new Set(a)].slice(0, n);
  return {
    phones: uniq(text.match(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g) ?? [], 5),
    emails: uniq(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [], 3),
    hours: uniq(lines.filter((l) => l.length < 160 && /(\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|24\/7|24 hours|hours)/i.test(l) && /\d/.test(l)), 8),
    serviceAreas: uniq(lines.filter((l) => /(serving|service area|we serve|areas? we serve|proudly serv)/i.test(l)), 6),
    services: uniq(lines.filter((l) => l.length >= 6 && l.length <= 120 && SERVICE_RE.test(l)), 20),
  };
}

function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  const disallow: string[] = [];
  for (const raw of robots.split('\n')) {
    const line = raw.split('#')[0].trim();
    const m = /^(user-agent|disallow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    if (m[1].toLowerCase() === 'user-agent') applies = m[2].trim() === '*' || /plumbvoice/i.test(m[2]);
    else if (applies && m[2].trim()) disallow.push(m[2].trim());
  }
  return !disallow.some((d) => path.startsWith(d));
}

async function getText(u: URL, accept: string): Promise<{status: number; text: string; type: string}> {
  let cur = u;
  for (let i = 0; i < 4; i++) {
    await assertPublicHttpUrl(cur.toString());
    const r = await safeRequest(cur, {headers: {'User-Agent': UA, Accept: accept}, timeoutMs: 8000, maxBytes: MAX_BYTES});
    const loc = r.headers.location;
    if (r.status >= 300 && r.status < 400 && typeof loc === 'string' && loc) {
      cur = new URL(loc, cur);
      continue;
    }
    const type = r.headers['content-type'];
    return {status: r.status, text: r.body.toString('utf8'), type: typeof type === 'string' ? type : ''};
  }
  throw new Error('Too many redirects.');
}

/** Reads the home page plus a few same-site pages (about/services/contact/faq), honouring robots.txt. */
export async function previewWebsite(rawUrl: string): Promise<KnowledgePreview> {
  const root = await assertPublicHttpUrl(rawUrl);
  let robots = '';
  try {
    const r = await getText(new URL('/robots.txt', root), 'text/plain');
    if (r.status === 200) robots = r.text;
  } catch { /* no robots.txt */ }
  const preview: KnowledgePreview = {url: root.toString(), pagesRead: [], title: '', description: '', phones: [], emails: [], hours: [], serviceAreas: [], services: [], blockedByRobots: false};
  if (!robotsAllows(robots, root.pathname)) {
    preview.blockedByRobots = true;
    return preview;
  }
  const home = await getText(root, 'text/html');
  if (home.status >= 400 || !/html/i.test(home.type)) throw new Error('The page could not be read as a web page.');
  preview.title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(home.text)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  preview.description = (/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(home.text)?.[1] ?? '').slice(0, 300);
  const links = new Set<string>();
  for (const m of home.text.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const l = new URL(m[1], root);
      if (l.host === root.host && /(about|service|contact|faq|hour|area)/i.test(l.pathname) && robotsAllows(robots, l.pathname)) links.add(l.toString());
    } catch { /* skip */ }
    if (links.size >= 4) break;
  }
  const pages = [{url: root.toString(), html: home.text}];
  for (const l of links) {
    try {
      const p = await getText(new URL(l), 'text/html');
      if (p.status < 400 && /html/i.test(p.type)) pages.push({url: l, html: p.text});
    } catch { /* ignore a failing sub-page */ }
  }
  const lines = pages.flatMap((p) => htmlToLines(p.html));
  preview.pagesRead = pages.map((p) => p.url);
  Object.assign(preview, extractFacts(lines));
  return preview;
}
