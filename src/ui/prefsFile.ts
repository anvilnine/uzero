// Export / import of Prefs as JSON, with strict validation on the way in.
import type { AccountMeta, LabelColor, Prefs } from '../lib/types';
import { LABEL_COLORS, cleanLabel } from './model';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SERVICE_ID = /^[a-z0-9-]{1,40}$/;

export const FILE_KIND = 'lineup-prefs';

export function exportPrefs(prefs: Prefs): string {
  return JSON.stringify({ kind: FILE_KIND, version: 1, prefs }, null, 2);
}

function email(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const e = x.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

export type ImportResult = { ok: true; prefs: Prefs; skipped: number } | { ok: false; error: string };

/** Parse and sanitize a prefs file. Unknown or invalid entries are dropped, never trusted. */
export function parsePrefs(text: string): ImportResult {
  if (text.length > 200_000) return { ok: false, error: 'That file is too large to be a Lineup backup.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON.' };
  }
  const root = raw as { kind?: unknown; prefs?: unknown };
  const p = (root && typeof root === 'object' && root.kind === FILE_KIND ? root.prefs : raw) as
    | Record<string, unknown>
    | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.order)) {
    return { ok: false, error: 'That file isn’t a Lineup backup.' };
  }

  let skipped = 0;
  const order: string[] = [];
  for (const x of p.order.slice(0, 100)) {
    const e = email(x);
    if (e && !order.includes(e)) order.push(e);
    else skipped++;
  }

  const meta: Record<string, AccountMeta> = {};
  if (p.meta && typeof p.meta === 'object') {
    for (const [k, v] of Object.entries(p.meta as Record<string, unknown>).slice(0, 100)) {
      const e = email(k);
      if (!e || !v || typeof v !== 'object') {
        skipped++;
        continue;
      }
      const m = v as Record<string, unknown>;
      const out: AccountMeta = {};
      if (typeof m.label === 'string' && cleanLabel(m.label).trim()) out.label = cleanLabel(m.label).trim();
      if (typeof m.color === 'string' && LABEL_COLORS.includes(m.color as LabelColor))
        out.color = m.color as LabelColor;
      meta[e] = out;
    }
  }

  const serviceDefaults: Record<string, string> = {};
  if (p.serviceDefaults && typeof p.serviceDefaults === 'object') {
    for (const [k, v] of Object.entries(p.serviceDefaults as Record<string, unknown>).slice(0, 100)) {
      const e = email(v);
      if (SERVICE_ID.test(k) && e) serviceDefaults[k] = e;
      else skipped++;
    }
  }

  const disabledServices = Array.isArray(p.disabledServices)
    ? p.disabledServices.filter((x): x is string => typeof x === 'string' && SERVICE_ID.test(x)).slice(0, 100)
    : [];

  return {
    ok: true,
    skipped,
    prefs: {
      order,
      meta,
      pinEnabled: p.pinEnabled === true,
      serviceDefaults,
      disabledServices,
    },
  };
}
