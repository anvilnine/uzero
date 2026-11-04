// Read the signed-in Google accounts from ListAccounts (the endpoint Chromium uses).
// Row layout follows Chromium's ListAccounts parser; index handling borrows the idea from
// piro0919/account-switcher-for-google (MIT).
import type { Account, Prefs } from './types';

export const LIST_ACCOUNTS_URL =
  'https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard';

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** Lower-cased email, or null if it does not look like one. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

const PHOTO_DOMAINS = ['googleusercontent.com', 'ggpht.com'];

/** Avatar URL, only from Google's image hosts over https. */
export function safePhoto(input: unknown): string {
  if (typeof input !== 'string') return '';
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    const ok = url.protocol === 'https:' && PHOTO_DOMAINS.some((d) => host.endsWith(`.${d}`));
    return ok ? url.href : '';
  } catch {
    return '';
  }
}

export const MAX_ACCOUNTS = 100;

/** Valid, lower-cased, de-duplicated emails. */
export function sanitizeEmails(input: unknown, max = MAX_ACCOUNTS): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const v of input) {
    const e = normalizeEmail(v);
    if (e) out.add(e);
    if (out.size >= max) break;
  }
  return [...out];
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Parse a ListAccounts body. Never throws: garbage gives an empty list. */
export function parseListAccounts(body: unknown): Account[] {
  if (typeof body !== 'string') return [];
  const text = body.trimStart().replace(/^\)\]\}'[^\n]*\n?/, '');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];

  const out: Account[] = [];
  const seen = new Set<string>();
  let signedInSoFar = 0;

  for (const row of data[1] as unknown[]) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const signedOut = row[14] === 1;
    // Every signed-in row holds a /u/N slot, even one we can't use (or that needs re-auth).
    const slot = signedOut ? -1 : signedInSoFar++;
    const email = normalizeEmail(row[3]);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const index = signedOut ? -1 : isInt(row[7]) ? row[7] : slot;
    out.push({
      email,
      name: typeof row[2] === 'string' ? row[2].slice(0, 200) : '',
      photo: safePhoto(row[4]),
      index,
      signedOut,
    });
  }

  return out.sort((a, b) => {
    if (a.signedOut !== b.signedOut) return a.signedOut ? 1 : -1;
    return a.index - b.index;
  });
}

/** Signed-in email -> Google index. */
export function indexByEmail(accounts: readonly Account[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of accounts) if (!a.signedOut && a.index >= 0) map.set(a.email, a.index);
  return map;
}

/**
 * Pin mode's default account: the first email in the user's order that is signed in now
 * (then any other signed-in account, in Google order). Undefined when nobody is signed in.
 * Popup, options and the DNR rules all use this, so what the UI says is what the rules do.
 */
export function defaultEmail(order: readonly string[], accounts: readonly Account[]): string | undefined {
  const index = indexByEmail(accounts);
  const inOrder = order.find((e) => index.has(e));
  if (inOrder !== undefined) return inOrder;
  return [...index].sort((a, b) => a[1] - b[1])[0]?.[0];
}

/** The account pin mode opens `serviceId` as: its override while signed in, else the default. */
export function pinEmail(
  prefs: Pick<Prefs, 'order' | 'serviceDefaults'>,
  accounts: readonly Account[],
  serviceId?: string,
): string | undefined {
  const override = serviceId === undefined ? undefined : prefs.serviceDefaults[serviceId];
  if (override !== undefined && indexByEmail(accounts).has(override)) return override;
  return defaultEmail(prefs.order, accounts);
}

/** POST ListAccounts with cookies. Needs the Origin rule (see background) or Google answers 403. */
export async function fetchAccounts(fetchFn: typeof fetch = fetch, timeoutMs = 10_000): Promise<Account[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(LIST_ACCOUNTS_URL, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Google answered ${res.status}`);
    return parseListAccounts(await res.text());
  } finally {
    clearTimeout(timer);
  }
}
