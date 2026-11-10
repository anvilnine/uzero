// Running totals of what Uzero did for this user. They live in extension storage on this device
// and nothing in Uzero sends them anywhere. The options page shows them, and the share text can
// quote them when the user clicks a share button.
import { SHARE_TEXT } from './ask';

export interface Stats {
  /** Google links that named no account and that Pin sent to the chosen account. */
  pinnedLinks: number;
  /** Tabs moved to another account from the popup or with Alt+1 to Alt+4. */
  tabSwitches: number;
  /** Reorder guides that reached the end. */
  reorders: number;
  /** Accounts signed back in across all finished reorders. */
  accountsReordered: number;
  /** When counting started, ms since epoch. Set on the first count. */
  since?: number;
}

export type Counter = Exclude<keyof Stats, 'since'>;

export const STATS_KEY = 'uzero:stats';
export const COUNTERS: readonly Counter[] = ['pinnedLinks', 'tabSwitches', 'reorders', 'accountsReordered'];
export const EMPTY_STATS: Stats = { pinnedLinks: 0, tabSwitches: 0, reorders: 0, accountsReordered: 0 };
/** Upper bound for any counter, so a corrupt value can never grow without limit. */
export const STAT_MAX = 1_000_000_000;
/** Share text quotes the link count only from this many links up. */
export const SHARE_FROM_LINKS = 25;

function count(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, STAT_MAX) : 0;
}

export function sanitizeStats(input: unknown): Stats {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Stats = { ...EMPTY_STATS };
  for (const k of COUNTERS) out[k] = count(raw[k]);
  if (typeof raw.since === 'number' && Number.isFinite(raw.since) && raw.since > 0) out.since = raw.since;
  return out;
}

/** Add to one or more counters. Negative or broken amounts are ignored. */
export function bump(s: Stats, add: Partial<Record<Counter, number>>, now: number): Stats {
  const out = sanitizeStats(s);
  let changed = false;
  for (const k of COUNTERS) {
    const n = count(add[k]);
    if (!n) continue;
    out[k] = Math.min(out[k] + n, STAT_MAX);
    changed = true;
  }
  if (changed && !out.since) out.since = now;
  return out;
}

export function hasStats(s: Stats): boolean {
  return COUNTERS.some((k) => s[k] > 0);
}

export function formatCount(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

function plural(n: number, one: string, many: string, locale?: string): string {
  return `${formatCount(n, locale)} ${n === 1 ? one : many}`;
}

export interface StatRow {
  id: Counter;
  label: string;
  value: string;
}

/** Rows for the options page. Counters still at zero are left out. */
export function statRows(s: Stats, locale?: string): StatRow[] {
  const rows: StatRow[] = [];
  if (s.pinnedLinks) rows.push({ id: 'pinnedLinks', label: 'Links Pin opened in the right account', value: formatCount(s.pinnedLinks, locale) });
  if (s.tabSwitches) rows.push({ id: 'tabSwitches', label: 'Tabs you switched to another account', value: formatCount(s.tabSwitches, locale) });
  if (s.reorders) {
    rows.push({
      id: 'reorders',
      label: s.reorders === 1 ? 'Reorder finished' : 'Reorders finished',
      value: s.accountsReordered
        ? `${formatCount(s.reorders, locale)} (${plural(s.accountsReordered, 'account', 'accounts', locale)})`
        : formatCount(s.reorders, locale),
    });
  }
  return rows;
}

/**
 * Short line for the popup's Pin card, under "Links without an account open as ...".
 * Null until Pin has opened something.
 */
export function pinLine(s: Stats, locale?: string): string | null {
  if (!s.pinnedLinks) return null;
  return `${formatCount(s.pinnedLinks, locale)} opened so far.`;
}

/** Share text. Quotes the user's own link count once it is worth bragging about. */
export function shareText(s: Stats, locale?: string): string {
  if (s.pinnedLinks >= SHARE_FROM_LINKS) {
    return `Uzero has opened ${formatCount(s.pinnedLinks, locale)} Google links in the right account for me. I've stopped landing in the wrong inbox.`;
  }
  return SHARE_TEXT;
}

// ---- storage -----------------------------------------------------------------
// Same pattern as ask.ts: extension storage when there is a runtime, localStorage in the
// design preview.

function hasExtStorage(): boolean {
  return typeof browser !== 'undefined' && !!browser.runtime?.id && !!browser.storage?.local;
}

export async function loadStats(): Promise<Stats> {
  try {
    if (hasExtStorage()) {
      const got = await browser.storage.local.get(STATS_KEY);
      return sanitizeStats(got[STATS_KEY]);
    }
    return sanitizeStats(JSON.parse(localStorage.getItem(STATS_KEY) ?? 'null'));
  } catch {
    return { ...EMPTY_STATS };
  }
}

export async function saveStats(s: Stats): Promise<void> {
  try {
    if (hasExtStorage()) await browser.storage.local.set({ [STATS_KEY]: s });
    else localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked: the counts are a nicety, never worth an error.
  }
}
