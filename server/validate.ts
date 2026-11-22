/** Small input-validation helpers so route handlers never trust raw request bodies. */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Trimmed string capped at `max` characters. Returns `fallback` for non-strings. */
export function str(v: unknown, max: number, fallback = ''): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : fallback;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function num(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

export function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isEmail(v: string): boolean {
  return v.length <= 254 && EMAIL_RE.test(v);
}

export function isValidDateISO(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** Copy only keys whose validator returned a value (undefined = reject/ignore). */
export function buildPatch<T extends object>(
  body: unknown,
  rules: {[K in keyof T]?: (v: unknown) => T[K] | undefined}
): Partial<T> {
  const out: Partial<T> = {};
  if (!isRecord(body)) return out;
  for (const key of Object.keys(rules) as (keyof T)[]) {
    if (!(key in body)) continue;
    const rule = rules[key];
    if (!rule) continue;
    const value = rule((body as Record<string, unknown>)[key as string]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Keep only the listed keys that are actually present (never creates `undefined` entries). */
export function pick<T extends object>(obj: Partial<T>, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** Neutralise spreadsheet formula injection in exported CSV cells. */
export function csvCell(val: unknown): string {
  let s = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
