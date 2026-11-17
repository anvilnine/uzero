import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_PREFS, type Account, type Prefs } from './types';
import { accountsItem, applyPrefsPatch, mergeOrder, prefsItem, sanitizeLabel, sanitizePrefs, wizardItem } from './store';

const acct = (email: string, index: number): Account => ({ email, name: '', photo: '', index, signedOut: index < 0 });

describe('sanitizeLabel', () => {
  it.each([
    ['  Work  ', 'Work'],
    ['a\u0000b\u001fc\u007f', 'abc'],
    ['evil‮olleh', 'evilolleh'],
    ['zero​width', 'zerowidth'],
    ['x'.repeat(40), 'x'.repeat(24)],
    ['😀'.repeat(30), '😀'.repeat(24)],
    [42, ''],
    [null, ''],
  ])('%j -> %j', (input, out) => expect(sanitizeLabel(input)).toBe(out));
});

describe('sanitizePrefs', () => {
  it('turns garbage into defaults', () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs('x')).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs({ pinEnabled: 'yes', order: 'a@x.com' })).toEqual(DEFAULT_PREFS);
  });

  it('validates every field', () => {
    const out = sanitizePrefs({
      order: ['B@x.com', 'b@x.com', 'bad', 'c@x.com'],
      meta: {
        'B@X.com': { label: ' Work\u0000 ', color: 'blue', extra: 1 },
        'c@x.com': { color: 'neon' },
        nope: { label: 'x' },
      },
      pinEnabled: true,
      serviceDefaults: { gmail: 'C@x.com', unknown: 'a@x.com', meet: 'bad' },
      disabledServices: ['meet', 'meet', 'unknown', 3],
      sneaky: true,
    });
    expect(out).toEqual<Prefs>({
      order: ['b@x.com', 'c@x.com'],
      meta: { 'b@x.com': { label: 'Work', color: 'blue' } },
      pinEnabled: true,
      serviceDefaults: { gmail: 'c@x.com' },
      disabledServices: ['meet'],
      safariGuideMode: 'window',
    });
  });
});

describe('applyPrefsPatch', () => {
  const prev: Prefs = { ...DEFAULT_PREFS, order: ['a@x.com', 'b@x.com'], pinEnabled: true };

  it('changes only the patched keys', () => {
    const next = applyPrefsPatch(prev, { pinEnabled: false });
    expect(next).toEqual({ ...prev, pinEnabled: false });
  });

  it('validates patched values', () => {
    expect(applyPrefsPatch(prev, { order: ['B@x.com', 'zzz'] }).order).toEqual(['b@x.com']);
    expect(applyPrefsPatch(prev, { pinEnabled: 1 as unknown as boolean }).pinEnabled).toBe(false);
  });

  it('ignores non-objects and unknown keys', () => {
    expect(applyPrefsPatch(prev, null)).toBe(prev);
    expect(applyPrefsPatch(prev, { __proto__: { pinEnabled: false }, other: 1 } as unknown)).toEqual(prev);
  });
});

describe('mergeOrder', () => {
  it('appends new accounts in Google order and keeps missing ones', () => {
    const accounts = [acct('a@x.com', 0), acct('new@x.com', 1), acct('out@x.com', -1)];
    expect(mergeOrder(['old@x.com', 'a@x.com'], accounts)).toEqual(['old@x.com', 'a@x.com', 'new@x.com', 'out@x.com']);
  });

  it('is stable when nothing is new', () => {
    expect(mergeOrder(['b@x.com', 'a@x.com'], [acct('a@x.com', 0), acct('b@x.com', 1)])).toEqual(['b@x.com', 'a@x.com']);
  });
});

describe('storage items', () => {
  beforeEach(() => fakeBrowser.reset());

  it('fall back to defaults and round-trip', async () => {
    expect(await prefsItem.getValue()).toEqual(DEFAULT_PREFS);
    expect(await accountsItem.getValue()).toEqual([]);
    expect(await wizardItem.getValue()).toBeNull();
    await accountsItem.setValue([acct('a@x.com', 0)]);
    expect(await accountsItem.getValue()).toEqual([acct('a@x.com', 0)]);
    expect(await fakeBrowser.storage.local.get('accounts')).toEqual({ accounts: [acct('a@x.com', 0)] });
  });
});


describe('Safari guide preference', () => {
  beforeEach(() => fakeBrowser.reset());

  it('defaults missing values to a guide window', () => {
    expect(DEFAULT_PREFS.safariGuideMode).toBe('window');
    expect(sanitizePrefs({ order: ['a@x.com'] }).safariGuideMode).toBe('window');
  });

  it.each(['window', 'overlay'])('accepts %s in validated patches', (mode) => {
    const next = applyPrefsPatch(DEFAULT_PREFS, { safariGuideMode: mode });
    expect(next.safariGuideMode).toBe(mode);
    expect(applyPrefsPatch(next, { pinEnabled: true }).safariGuideMode).toBe(mode);
  });

  it.each([undefined, null, true, 1, '', 'OVERLAY', 'side-panel', {}, []])('defaults invalid %j values', (value) => {
    expect(sanitizePrefs({ safariGuideMode: value }).safariGuideMode).toBe('window');
    expect(applyPrefsPatch({ ...DEFAULT_PREFS, safariGuideMode: 'overlay' }, { safariGuideMode: value }).safariGuideMode).toBe('window');
  });

  it('reads old stored prefs without losing existing settings', async () => {
    const old = { order: ['a@x.com'], meta: {}, pinEnabled: true, serviceDefaults: {}, disabledServices: ['meet'] };
    await fakeBrowser.storage.local.set({ prefs: old });
    expect(await prefsItem.getValue()).toEqual({ ...old, safariGuideMode: 'window' });
  });

  it('validates stored values and persists either supported mode', async () => {
    await fakeBrowser.storage.local.set({ prefs: { ...DEFAULT_PREFS, safariGuideMode: 'bad' } });
    expect((await prefsItem.getValue()).safariGuideMode).toBe('window');
    for (const safariGuideMode of ['window', 'overlay'] as const) {
      await prefsItem.setValue({ ...DEFAULT_PREFS, safariGuideMode });
      expect((await prefsItem.getValue()).safariGuideMode).toBe(safariGuideMode);
      expect((await fakeBrowser.storage.local.get('prefs')).prefs).toMatchObject({ safariGuideMode });
    }
  });
});
