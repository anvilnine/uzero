// Account label rules: pure, storage-free, shared by the background (store.ts) and the UI.
import type { LabelColor } from './types';

export const LABEL_MAX = 24;

/** Label colors, in the order the UI offers them. */
export const LABEL_COLORS: readonly LabelColor[] = [
  'slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink',
];
const COLORS: ReadonlySet<string> = new Set(LABEL_COLORS);

export function isLabelColor(v: unknown): v is LabelColor {
  return typeof v === 'string' && COLORS.has(v);
}

// Control chars plus zero-width and bidi overrides (they can spoof how a label reads).
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

/** Drop control characters and cap at 24 chars, without trimming (for a label still being typed). */
export function cleanLabel(input: string): string {
  return [...input.replace(CONTROL_RE, '')].slice(0, LABEL_MAX).join('');
}

/** Trim, drop control characters, cap at 24 chars. */
export function sanitizeLabel(input: unknown): string {
  if (typeof input !== 'string') return '';
  return [...input.replace(CONTROL_RE, '').trim()]
    .slice(0, LABEL_MAX)
    .join('')
    .trim();
}
