import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, type Prefs } from '../lib/types';
import { exportPrefs, parsePrefs } from './prefsFile';

const ok = (text: string) => {
  const r = parsePrefs(text);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('parsePrefs', () => {
  it('round-trips an export', () => {
    const prefs: Prefs = {
      order: ['b@x.com', 'a@x.com'],
      meta: { 'b@x.com': { label: 'Work', color: 'blue' } },
      pinEnabled: true,
      serviceDefaults: { gmail: 'a@x.com' },
      disabledServices: ['maps'],
      safariGuideMode: 'window',
    };
    expect(ok(exportPrefs(prefs))).toEqual({ ok: true, skipped: 0, prefs });
  });

  it('accepts backups made before the rename (lineup-prefs)', () => {
    const text = JSON.stringify({ kind: 'lineup-prefs', version: 1, prefs: { order: ['a@x.com'] } });
    expect(ok(text).prefs).toEqual({ ...DEFAULT_PREFS, order: ['a@x.com'] });
  });

  it('accepts bare prefs without the wrapper', () => {
    expect(ok(JSON.stringify({ order: ['A@x.com'] })).prefs).toEqual({ ...DEFAULT_PREFS, order: ['a@x.com'] });
  });

  it('drops and counts invalid entries, with the same rules the background uses', () => {
    const r = ok(
      JSON.stringify({
        kind: 'uzero-prefs',
        version: 1,
        prefs: {
          order: ['B@x.com', 'b@x.com', 'not an email', 7, 'a<b>@x.com'],
          meta: {
            'b@x.com': { label: '  Wo‮rk\u0000  ', color: 'neon' },
            'c@x.com': { label: 'x'.repeat(40), color: 'pink' },
            nope: { label: 'x' },
            'd@x.com': 'string',
          },
          pinEnabled: 'yes',
          serviceDefaults: { gmail: 'C@x.com', evil: 'a@x.com', meet: 'bad' },
          disabledServices: ['meet', 'meet', 'unknown', 3],
        },
      }),
    );
    expect(r.prefs).toEqual<Prefs>({
      order: ['b@x.com'],
      meta: { 'b@x.com': { label: 'Work' }, 'c@x.com': { label: 'x'.repeat(24), color: 'pink' } },
      pinEnabled: false,
      serviceDefaults: { gmail: 'c@x.com' },
      disabledServices: ['meet'],
      safariGuideMode: 'window',
    });
    // 4 bad order entries (dup, 2 junk, 1 bad email), 2 bad meta keys, 2 bad service defaults.
    expect(r.skipped).toBe(8);
  });

  it('caps the number of accounts', () => {
    const order = Array.from({ length: 150 }, (_, i) => `u${i}@x.com`);
    expect(ok(JSON.stringify({ order })).prefs.order).toHaveLength(100);
  });

  it.each([
    ['not json', 'valid JSON'],
    ['null', 'Uzero backup'],
    ['[]', 'Uzero backup'],
    ['{"kind":"lineup-prefs","prefs":{"order":"a@x.com"}}', 'Uzero backup'],
    [`"${'x'.repeat(200_001)}"`, 'too large'],
  ])('rejects %s', (text, error) => {
    const r = parsePrefs(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(error);
  });
});


describe('Safari guide backups', () => {
  it.each(['window', 'overlay'] as const)('round-trips %s', (safariGuideMode) => {
    const prefs = { ...DEFAULT_PREFS, safariGuideMode };
    expect(ok(exportPrefs(prefs)).prefs).toEqual(prefs);
  });

  it.each(['uzero-prefs', 'lineup-prefs'])('defaults old %s backups', (kind) => {
    expect(ok(JSON.stringify({ kind, version: 1, prefs: { order: [] } })).prefs.safariGuideMode).toBe('window');
  });

  it.each([null, true, 3, '', 'OVERLAY', {}, []])('rejects invalid guide mode %j', (safariGuideMode) => {
    expect(ok(JSON.stringify({ order: [], safariGuideMode })).prefs.safariGuideMode).toBe('window');
  });
});
