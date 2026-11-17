// UI-only helpers shared by popup, options and the reorder wizard.
import type { Account, AccountMeta, AppState, LabelColor, Prefs } from '../lib/types';
import { safePhoto } from '../lib/accounts';
import { LABEL_COLORS, isLabelColor } from '../lib/labels';

// Label rules live in lib/labels (the background applies the same ones before storing).
export { LABEL_COLORS, LABEL_MAX, cleanLabel } from '../lib/labels';

export const COLOR_NAMES: Record<LabelColor, string> = {
  slate: 'Slate',
  red: 'Red',
  orange: 'Orange',
  amber: 'Amber',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  violet: 'Violet',
  pink: 'Pink',
};

/** One row of the user's lineup: their slot, plus what Google knows (if anything). */
export interface Row {
  email: string;
  /** 1-based position in the user's order. */
  slot: number;
  account: Account | null;
  meta: AccountMeta;
  name: string;
  /** Signed out, or no longer reported by Google at all. */
  inactive: boolean;
}

/** Merge Google's accounts into the user's order. Unknown emails go last. */
export function lineup(state: Pick<AppState, 'accounts' | 'prefs'>): Row[] {
  const byEmail = new Map(state.accounts.map((a) => [a.email, a]));
  const emails = [...state.prefs.order];
  for (const a of state.accounts) if (!emails.includes(a.email)) emails.push(a.email);
  return emails.map((email, i) => {
    const account = byEmail.get(email) ?? null;
    return {
      email,
      slot: i + 1,
      account,
      meta: state.prefs.meta[email] ?? {},
      name: account?.name || email.split('@')[0] || email,
      inactive: !account || account.signedOut,
    };
  });
}

export function initials(name: string, email: string): string {
  const src = name.trim() || email;
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

/** Stable fallback tone for accounts the user has not colored. */
export function autoTone(email: string): LabelColor {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length] ?? 'slate';
}

export function toneOf(row: { email: string; meta: AccountMeta }): LabelColor {
  return row.meta.color ?? autoTone(row.email);
}

export function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

// ---- Popup paint cache -------------------------------------------------------
// The popup paints the last known state synchronously, then refreshes. The cache holds account
// emails, names and photos, so it is dropped as soon as no accounts are left, and anything that
// doesn't look exactly like a state we wrote is ignored.

const CACHE_KEY = 'uzero:last-state';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function isAccount(v: unknown): v is Account {
  return (
    isObj(v) &&
    typeof v.email === 'string' &&
    typeof v.name === 'string' &&
    typeof v.photo === 'string' &&
    Number.isInteger(v.index) &&
    typeof v.signedOut === 'boolean'
  );
}

function isMeta(v: unknown): v is AccountMeta {
  return (
    isObj(v) &&
    (v.label === undefined || typeof v.label === 'string') &&
    (v.color === undefined || isLabelColor(v.color))
  );
}

function isPrefs(v: unknown): v is Prefs {
  return (
    isObj(v) &&
    isStrings(v.order) &&
    isObj(v.meta) &&
    Object.values(v.meta).every(isMeta) &&
    typeof v.pinEnabled === 'boolean' &&
    isObj(v.serviceDefaults) &&
    Object.values(v.serviceDefaults).every((x) => typeof x === 'string') &&
    isStrings(v.disabledServices)
  );
}

export function readCache(): AppState | null {
  // Safari may open this popup privately. Wait for the background context check, never paint cached accounts.
  if (import.meta.env.BROWSER === 'safari') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const s: unknown = JSON.parse(raw);
    if (!isObj(s) || !Array.isArray(s.accounts) || s.accounts.length === 0 || !s.accounts.every(isAccount)) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    if (!isPrefs(s.prefs)) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    // Photos are rendered as <img>, so only Google's image hosts survive, as on the way in.
    const accounts = s.accounts.map((a) => ({ ...a, photo: safePhoto(a.photo) }));
    // Status and wizard are never trusted from the cache; the background sends the real ones.
    return { accounts, prefs: s.prefs, status: { kind: 'idle' }, wizard: null };
  } catch {
    return null;
  }
}

export function writeCache(s: AppState): void {
  if (import.meta.env.BROWSER === 'safari') return;
  try {
    if (s.accounts.length === 0) localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, JSON.stringify({ accounts: s.accounts, prefs: s.prefs }));
  } catch {
    /* storage full or blocked: painting from cache is optional */
  }
}
