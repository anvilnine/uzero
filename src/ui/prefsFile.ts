// Export / import of Prefs as JSON, with strict validation on the way in.
// Same rules as lib/store, which the background applies again when the prefs are saved.
import type { AccountMeta, Prefs } from '../lib/types';
import { MAX_ACCOUNTS, normalizeEmail } from '../lib/accounts';
import { SERVICE_IDS } from '../lib/services';
import { isLabelColor, sanitizeLabel } from '../lib/labels';

export const FILE_KIND = 'uzero-prefs';
/** Backups made before the rename to Uzero. */
const LEGACY_KINDS = new Set<unknown>([FILE_KIND, 'lineup-prefs']);

export function exportPrefs(prefs: Prefs): string {
  return JSON.stringify({ kind: FILE_KIND, version: 1, prefs }, null, 2);
}

export type ImportResult = { ok: true; prefs: Prefs; skipped: number } | { ok: false; error: string };

/** Parse and sanitize a prefs file. Unknown or invalid entries are dropped, never trusted. */
export function parsePrefs(text: string): ImportResult {
  if (text.length > 200_000) return { ok: false, error: 'That file is too large to be a Uzero backup.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON.' };
  }
  const root = raw as { kind?: unknown; prefs?: unknown };
  const p = (root && typeof root === 'object' && LEGACY_KINDS.has(root.kind) ? root.prefs : raw) as
    | Record<string, unknown>
    | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.order)) {
    return { ok: false, error: 'That file isn’t a Uzero backup.' };
  }

  let skipped = 0;
  const order: string[] = [];
  for (const x of p.order.slice(0, MAX_ACCOUNTS)) {
    const e = normalizeEmail(x);
    if (e && !order.includes(e)) order.push(e);
    else skipped++;
  }

  const meta: Record<string, AccountMeta> = {};
  if (p.meta && typeof p.meta === 'object') {
    for (const [k, v] of Object.entries(p.meta as Record<string, unknown>).slice(0, MAX_ACCOUNTS)) {
      const e = normalizeEmail(k);
      if (!e || !v || typeof v !== 'object') {
        skipped++;
        continue;
      }
      const m = v as Record<string, unknown>;
      const out: AccountMeta = {};
      const label = sanitizeLabel(m.label);
      if (label) out.label = label;
      if (isLabelColor(m.color)) out.color = m.color;
      meta[e] = out;
    }
  }

  const serviceDefaults: Record<string, string> = {};
  if (p.serviceDefaults && typeof p.serviceDefaults === 'object') {
    for (const [k, v] of Object.entries(p.serviceDefaults as Record<string, unknown>).slice(0, 100)) {
      const e = normalizeEmail(v);
      if (SERVICE_IDS.has(k) && e) serviceDefaults[k] = e;
      else skipped++;
    }
  }

  const disabledServices = Array.isArray(p.disabledServices)
    ? [...new Set(p.disabledServices.filter((x): x is string => typeof x === 'string' && SERVICE_IDS.has(x)))]
    : [];

  return {
    ok: true,
    skipped,
    prefs: {
      safariGuideMode: p.safariGuideMode === 'overlay' ? 'overlay' : 'window',
      order,
      meta,
      pinEnabled: p.pinEnabled === true,
      serviceDefaults,
      disabledServices,
    },
  };
}
