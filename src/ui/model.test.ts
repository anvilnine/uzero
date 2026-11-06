import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, type Account, type AppState } from '../lib/types';
import { cleanLabel, lineup, readCache, writeCache } from './model';

const acct = (email: string, index: number, o: Partial<Account> = {}): Account => ({
  email, name: '', photo: '', index, signedOut: index < 0, ...o,
});

describe('lineup', () => {
  it('follows your order, then appends accounts Google knows that you haven’t placed', () => {
    const rows = lineup({
      accounts: [acct('a@x.com', 0, { name: 'Ana' }), acct('b@x.com', 1), acct('new@x.com', 2), acct('out@x.com', -1)],
      prefs: { ...DEFAULT_PREFS, order: ['b@x.com', 'gone@x.com', 'a@x.com'], meta: { 'b@x.com': { label: 'Work' } } },
    });
    expect(rows.map((r) => [r.email, r.slot, r.inactive])).toEqual([
      ['b@x.com', 1, false],
      ['gone@x.com', 2, true],
      ['a@x.com', 3, false],
      ['new@x.com', 4, false],
      ['out@x.com', 5, true],
    ]);
    expect(rows[0]).toMatchObject({ meta: { label: 'Work' }, name: 'b' });
    expect(rows[1]?.account).toBeNull();
    expect(rows[2]?.name).toBe('Ana');
  });
});

describe('cleanLabel', () => {
  it('drops control and bidi characters but keeps spaces while typing', () => {
    expect(cleanLabel(' Wo‮rk\u0000 ')).toBe(' Work ');
    expect(cleanLabel('x'.repeat(30))).toHaveLength(24);
  });
});

describe('paint cache', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const state: AppState = {
    accounts: [acct('a@x.com', 0, { photo: 'https://lh3.googleusercontent.com/a/x' })],
    prefs: { ...DEFAULT_PREFS, order: ['a@x.com'], meta: { 'a@x.com': { label: 'Me', color: 'blue' } } },
    status: { kind: 'ok', at: 1 },
    wizard: null,
  };

  it('round-trips accounts and prefs, never status or wizard', () => {
    writeCache({ ...state, wizard: { phase: 'signing-in', queue: [], current: 0, completed: [], startedAt: 0 } });
    expect(readCache()).toEqual({ ...state, status: { kind: 'idle' }, wizard: null });
  });

  it('drops photos that are not on Google’s image hosts', () => {
    store.set(
      'uzero:last-state',
      JSON.stringify({ ...state, accounts: [acct('a@x.com', 0, { photo: 'https://evil.example.com/p.png' })] }),
    );
    expect(readCache()?.accounts[0]?.photo).toBe('');
  });

  it('ignores and removes anything that does not look like what it wrote', () => {
    for (const bad of [
      { accounts: [], prefs: state.prefs },
      { accounts: [{ email: 'a@x.com' }], prefs: state.prefs },
      { accounts: state.accounts, prefs: { ...state.prefs, pinEnabled: 'yes' } },
      { accounts: state.accounts, prefs: { ...state.prefs, meta: { 'a@x.com': { color: 'neon' } } } },
    ]) {
      store.set('uzero:last-state', JSON.stringify(bad));
      expect(readCache()).toBeNull();
      expect(store.has('uzero:last-state')).toBe(false);
    }
    store.set('uzero:last-state', '{not json');
    expect(readCache()).toBeNull();
  });

  it('forgets everything once no accounts are left', () => {
    writeCache(state);
    writeCache({ ...state, accounts: [] });
    expect(store.size).toBe(0);
  });
});
