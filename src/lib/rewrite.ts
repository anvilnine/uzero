// Pure URL rewriting: point a Google URL at account index N.
import type { Account } from './types';
import { EXTRA_QUERY_HOSTS, findService, isNeverRewrite, underSegment, type Service } from './services';

/** Service id reported for EXTRA_QUERY_HOSTS pages (switchable, but not in the catalog). */
export const OTHER_SERVICE_ID = 'other';

const MAX_INDEX = 99;

interface Target {
  url: URL;
  service: Service | undefined;
  /** Where /u/N/ lives for this URL ('' = root). */
  base: string;
  /** True when the account goes in the path, false for ?authuser. */
  pathStyle: boolean;
}

/** /u/N at the start of a path (after the service base). */
const U_RE = /^\/u\/(\d+)(?=\/|$)/;
/** /u/N anywhere in the path, first occurrence (Gmail Chat lives at /chat/u/0/, for example). */
const U_ANY_RE = /\/u\/(\d+)(?=\/|$)/;

/** Where an existing /u/N segment sits in the path, if any. */
function findU(t: Target): { start: number; end: number; index: number } | null {
  const path = t.url.pathname;
  if (t.service?.style === 'path') {
    const m = U_ANY_RE.exec(path);
    return m ? { start: m.index, end: m.index + m[0].length, index: Number(m[1]) } : null;
  }
  const m = U_RE.exec(path.slice(t.base.length));
  if (!m) return null;
  const start = t.base.length + m.index;
  return { start, end: start + m[0].length, index: Number(m[1]) };
}

/** Raw query parts, left as the page wrote them (no re-encoding of ~, spaces or %2F). */
function queryParts(url: URL): string[] {
  return url.search.slice(1).split('&').filter(Boolean);
}

function partKey(part: string): string {
  const raw = part.split('=', 1)[0]!.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function setQuery(url: URL, parts: string[]): void {
  url.search = parts.length ? `?${parts.join('&')}` : '';
}

/** Set ?authuser=N, touching only that one parameter. */
function setAuthuser(url: URL, index: number): void {
  let found = false;
  const parts: string[] = [];
  for (const p of queryParts(url)) {
    if (partKey(p) !== 'authuser') parts.push(p);
    else if (!found) {
      found = true;
      parts.push(`authuser=${index}`);
    }
  }
  if (!found) parts.push(`authuser=${index}`);
  setQuery(url, parts);
}

function dropAuthuser(url: URL): void {
  const parts = queryParts(url);
  const kept = parts.filter((p) => partKey(p) !== 'authuser');
  if (kept.length !== parts.length) setQuery(url, kept);
}

/** Gmail folders whose hash carries an argument: #label/Work, #search/foo, #category/social. */
const GMAIL_HASH_ARG = new Set(['label', 'search', 'category', 'settings', 'advanced-search', 'apps']);

/**
 * A Gmail thread id belongs to one account, so drop it when switching:
 * #inbox/FMfcg... -> #inbox, #label/Work/FMfcg... -> #label/Work.
 */
function gmailHash(hash: string): string {
  if (!hash.startsWith('#')) return hash;
  const q = hash.indexOf('?');
  const route = q < 0 ? hash.slice(1) : hash.slice(1, q);
  const parts = route.split('/');
  const keep = GMAIL_HASH_ARG.has(parts[0] ?? '') ? 2 : 1;
  return parts.length > keep ? `#${parts.slice(0, keep).join('/')}` : hash;
}

function resolve(input: string): Target | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const service = findService(url);
  if (!service && !EXTRA_QUERY_HOSTS.includes(url.hostname.toLowerCase())) return null;
  if (isNeverRewrite(url, service)) return null;

  if (service?.style === 'path') {
    const uAt = service.uAt ?? '';
    if (underSegment(url.pathname, uAt)) return { url, service, base: uAt, pathStyle: true };
    if (!service.queryElsewhere) return null;
  }
  return { url, service, base: '', pathStyle: false };
}

/** Return `input` rewritten to account `index`, or null when Uzero can't route this URL. */
export function toAccount(input: string, index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index > MAX_INDEX) return null;
  const t = resolve(input);
  if (!t) return null;
  const { url, base } = t;
  const path = url.pathname;
  const existing = findU(t);

  if (existing) {
    // Replace /u/N in place; ?authuser would fight with it.
    url.pathname = `${path.slice(0, existing.start)}/u/${index}${path.slice(existing.end) || '/'}`;
    dropAuthuser(url);
  } else if (t.pathStyle) {
    url.pathname = `${base}/u/${index}${path.slice(base.length) || '/'}`;
    dropAuthuser(url);
  } else {
    setAuthuser(url, index);
  }
  if (t.service?.id === 'gmail' && underSegment(url.pathname, '/mail')) url.hash = gmailHash(url.hash);
  return url.href;
}

/** Service id for a switchable URL, else null. */
export function switchableServiceId(input: string): string | null {
  const t = resolve(input);
  if (!t) return null;
  return t.service?.id ?? OTHER_SERVICE_ID;
}

/** Which signed-in account a Google URL is showing, by /u/N or ?authuser (default index 0). */
export function currentEmail(input: string, accounts: readonly Account[]): string | null {
  const t = resolve(input);
  if (!t) return null;
  const signedIn = accounts.filter((a) => !a.signedOut && a.index >= 0);
  const u = findU(t) ?? findU({ ...t, base: '' });
  const param = t.url.searchParams.get('authuser');
  let index = 0;
  if (u) index = u.index;
  else if (param !== null) {
    if (/^\d+$/.test(param)) index = Number(param);
    else return signedIn.find((a) => a.email === param.toLowerCase())?.email ?? null;
  }
  return signedIn.find((a) => a.index === index)?.email ?? null;
}
