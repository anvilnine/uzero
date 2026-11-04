// Typed storage items plus the pure validation that runs before anything is stored.
import { storage } from 'wxt/utils/storage';
import {
  DEFAULT_PREFS,
  KEY_ACCOUNTS,
  KEY_LOOP_PAUSES,
  KEY_PREFS,
  KEY_STATUS,
  KEY_WIZARD,
  type Account,
  type AccountMeta,
  type FetchStatus,
  type Prefs,
  type WizardState,
} from './types';
import { MAX_ACCOUNTS, normalizeEmail, sanitizeEmails } from './accounts';
import { isLabelColor, sanitizeLabel } from './labels';
import { SERVICE_IDS } from './services';

export const prefsItem = storage.defineItem<Prefs>(KEY_PREFS, { fallback: DEFAULT_PREFS });
export const accountsItem = storage.defineItem<Account[]>(KEY_ACCOUNTS, { fallback: [] });
export const statusItem = storage.defineItem<FetchStatus>(KEY_STATUS, { fallback: { kind: 'idle' } });
export const wizardItem = storage.defineItem<WizardState | null>(KEY_WIZARD, { fallback: null });
export const loopPausesItem = storage.defineItem<Record<string, number>>(KEY_LOOP_PAUSES, { fallback: {} });

// Label rules live in labels.ts so UI pages can use them without pulling in storage.
export { LABEL_COLORS, LABEL_MAX, cleanLabel, isLabelColor, sanitizeLabel } from './labels';

function sanitizeMeta(input: unknown): Record<string, AccountMeta> {
  const out: Record<string, AccountMeta> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, MAX_ACCOUNTS)) {
    const email = normalizeEmail(k);
    if (!email || !v || typeof v !== 'object') continue;
    const raw = v as Record<string, unknown>;
    const meta: AccountMeta = {};
    const label = sanitizeLabel(raw.label);
    if (label) meta.label = label;
    if (isLabelColor(raw.color)) meta.color = raw.color;
    if (meta.label || meta.color) out[email] = meta;
  }
  return out;
}

function sanitizeServiceDefaults(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [id, v] of Object.entries(input as Record<string, unknown>)) {
    const email = normalizeEmail(v);
    if (SERVICE_IDS.has(id) && email) out[id] = email;
  }
  return out;
}

/** Validate any value into Prefs. Unknown keys and bad values are dropped. */
export function sanitizePrefs(input: unknown): Prefs {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    order: sanitizeEmails(raw.order),
    meta: sanitizeMeta(raw.meta),
    pinEnabled: raw.pinEnabled === true,
    serviceDefaults: sanitizeServiceDefaults(raw.serviceDefaults),
    disabledServices: Array.isArray(raw.disabledServices)
      ? [...new Set(raw.disabledServices.filter((id): id is string => typeof id === 'string' && SERVICE_IDS.has(id)))]
      : [],
  };
}

/** Apply a UI patch. Only the keys present in `patch` change; each is validated. */
export function applyPrefsPatch(prev: Prefs, patch: unknown): Prefs {
  if (!patch || typeof patch !== 'object') return prev;
  return sanitizePrefs({ ...prev, ...pick(patch as Record<string, unknown>) });
}

const PREF_KEYS: (keyof Prefs)[] = ['order', 'meta', 'pinEnabled', 'serviceDefaults', 'disabledServices'];
function pick(p: Record<string, unknown>): Partial<Record<keyof Prefs, unknown>> {
  const out: Partial<Record<keyof Prefs, unknown>> = {};
  for (const k of PREF_KEYS) if (Object.hasOwn(p, k)) out[k] = p[k];
  return out;
}

/** Keep the user's order, append newly seen accounts in Google order. Missing ones stay (labels survive). */
export function mergeOrder(order: readonly string[], accounts: readonly Account[]): string[] {
  const out = [...order];
  const known = new Set(order);
  for (const a of accounts) {
    if (!known.has(a.email)) {
      out.push(a.email);
      known.add(a.email);
    }
  }
  return out.slice(0, MAX_ACCOUNTS);
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
