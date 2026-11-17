import { describe, expect, it } from 'vitest';
import type { Account, WizardState } from './types';
import {
  addToQueue, inProgress, isActive, isExpired, LOGOUT_URL, placeAdded, reduce, reorderQueue, restoreToQueue, signInUrl,
  stepChanged, tabUrlFor, WIZARD_TTL_MS,
} from './wizard';

const signedIn = (...emails: string[]): Account[] =>
  emails.map((email, index) => ({ email, name: '', photo: '', index, signedOut: false }));
const signedOut = (...emails: string[]): Account[] =>
  emails.map((email) => ({ email, name: '', photo: '', index: -1, signedOut: true }));

const QUEUE = ['b@x.com', 'a@x.com', 'c@x.com'];

function opened(): WizardState {
  return reduce(null, { type: 'open', queue: QUEUE, now: 1000 })!;
}

function signingIn(): WizardState {
  let s = reduce(opened(), { type: 'begin' });
  s = reduce(s, { type: 'accounts', accounts: signedOut('a@x.com') });
  return s!;
}

describe('wizard reducer', () => {
  it('opens in confirm with a cleaned queue', () => {
    const s = reduce(null, { type: 'open', queue: ['B@x.com', 'b@x.com', 'junk', 'a@x.com'], now: 5 });
    expect(s).toEqual({ phase: 'confirm', queue: ['b@x.com', 'a@x.com'], current: 0, completed: [], startedAt: 5 });
    expect(isActive(s)).toBe(false);
  });

  it('keeps the old Google tab when reopened', () => {
    const s = reduce({ ...opened(), tabId: 7 }, { type: 'open', queue: QUEUE, now: 2 });
    expect(s?.tabId).toBe(7);
    expect(s?.phase).toBe('confirm');
  });

  it('ignores events without state', () => {
    expect(reduce(null, { type: 'begin' })).toBeNull();
    expect(reduce(null, { type: 'accounts', accounts: [] })).toBeNull();
  });

  it('begin -> signing-out, waits until nobody is signed in', () => {
    let s = reduce(opened(), { type: 'begin' })!;
    expect(s.phase).toBe('signing-out');
    expect(isActive(s)).toBe(true);
    s = reduce(s, { type: 'accounts', accounts: signedIn('a@x.com') })!;
    expect(s.phase).toBe('signing-out');
    s = reduce(s, { type: 'accounts', accounts: signedOut('a@x.com', 'b@x.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 0, completed: [] });
  });

  it('walks the queue in order and finishes', () => {
    let s = signingIn();
    s = reduce(s, { type: 'accounts', accounts: [] })!; // nothing yet
    expect(s).toMatchObject({ phase: 'signing-in', current: 0 });
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 1, completed: ['b@x.com'] });
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com', 'a@x.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 2 });
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com', 'a@x.com', 'c@x.com') })!;
    expect(s).toMatchObject({ phase: 'done', current: 3, completed: ['b@x.com', 'a@x.com', 'c@x.com'] });
    expect(isActive(s)).toBe(false);
    // Done is final for ticks.
    expect(reduce(s, { type: 'accounts', accounts: [] })).toBe(s);
  });

  it('wrong account -> error, then skip moves on without re-erroring', () => {
    let s = signingIn();
    s = reduce(s, { type: 'accounts', accounts: signedIn('c@x.com') })!;
    expect(s.phase).toBe('error');
    expect(s.error).toContain('c@x.com');
    expect(s.error).toContain('b@x.com');
    expect(s.completed).toEqual(['c@x.com']);
    s = reduce(s, { type: 'skip' })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 1, error: undefined });
    s = reduce(s, { type: 'accounts', accounts: signedIn('c@x.com') })!;
    expect(s.phase).toBe('signing-in');
    s = reduce(s, { type: 'accounts', accounts: signedIn('c@x.com', 'a@x.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 2 });
  });

  it('retry after a wrong account starts over (the order is already off)', () => {
    let s = reduce(signingIn(), { type: 'accounts', accounts: signedIn('b@x.com') })!;
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com', 'c@x.com') })!;
    expect(s.phase).toBe('error');
    s = reduce(s, { type: 'retry' })!;
    expect(s).toMatchObject({ phase: 'signing-out', current: 0, completed: [] });
  });

  it('retry after a closed tab resumes when on track', () => {
    let s = reduce(signingIn(), { type: 'accounts', accounts: signedIn('b@x.com') })!;
    s = reduce({ ...s, tabId: 3 }, { type: 'tabClosed' })!;
    expect(s).toMatchObject({ phase: 'error', tabId: undefined });
    s = reduce(s, { type: 'retry' })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 1, completed: ['b@x.com'] });
  });

  it('tab closed outside an active phase only forgets the tab', () => {
    const s = reduce({ ...opened(), tabId: 3 }, { type: 'tabClosed' })!;
    expect(s).toMatchObject({ phase: 'confirm', tabId: undefined });
  });

  it('skip on the last account finishes', () => {
    let s: WizardState = { ...signingIn(), current: 2 };
    s = reduce(s, { type: 'skip' })!;
    expect(s.phase).toBe('done');
  });

  it('ignores actions in the wrong phase', () => {
    const c = opened();
    expect(reduce(c, { type: 'skip' })).toBe(c);
    expect(reduce(c, { type: 'retry' })).toBe(c);
    const s = signingIn();
    expect(reduce(s, { type: 'begin' })).toBe(s);
  });

  it('records the tab id', () => {
    expect(reduce(opened(), { type: 'tabOpened', tabId: 9 })?.tabId).toBe(9);
  });

  it('tags errors with their kind, and clears it on the way out', () => {
    let s = reduce(signingIn(), { type: 'accounts', accounts: signedIn('c@x.com') })!;
    expect(s.errorKind).toBe('wrong-account');
    s = reduce(s, { type: 'skip' })!;
    expect(s.errorKind).toBeUndefined();
    s = reduce({ ...s, tabId: 4 }, { type: 'tabClosed' })!;
    expect(s).toMatchObject({ phase: 'error', errorKind: 'tab-closed' });
    s = reduce(s, { type: 'retry' })!;
    expect(s.errorKind).toBeUndefined();
  });

  it('after Skip, moves on when the next account is already signed in at its place', () => {
    // b signed in, then c instead of a: error. Skipping a means c (already in) is next and in place.
    let s = reduce(signingIn(), { type: 'accounts', accounts: signedIn('b@x.com') })!;
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com', 'c@x.com') })!;
    expect(s).toMatchObject({ phase: 'error', current: 1, completed: ['b@x.com', 'c@x.com'] });
    s = reduce(s, { type: 'skip' })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 2 });
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com', 'c@x.com') })!;
    expect(s).toMatchObject({ phase: 'done', completed: ['b@x.com', 'c@x.com'] });
  });

  it('moves on when the expected account is already first after a skipped first step', () => {
    let s = reduce(signingIn(), { type: 'accounts', accounts: signedIn('a@x.com') })!;
    expect(s.phase).toBe('error'); // a instead of b
    s = reduce(s, { type: 'skip' })!; // skip b: a is next, and Google has it at #1
    s = reduce(s, { type: 'accounts', accounts: signedIn('a@x.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 2, completed: ['a@x.com'] });
  });

  it('flags an already signed-in account that sits in the wrong place', () => {
    // Queue b, a, c. Skip b and a; c is already signed in but behind a, which isn't an earlier target.
    let s: WizardState = { ...signingIn(), current: 1, completed: [] };
    s = reduce(s, { type: 'skip' })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 2 });
    const t = reduce({ ...s, completed: ['x@x.com', 'c@x.com'] }, { type: 'accounts', accounts: signedIn('x@x.com', 'c@x.com') })!;
    expect(t).toMatchObject({ phase: 'error', errorKind: 'out-of-order' });
    expect(t.error).toContain('c@x.com');
  });

  it('open never resets a reorder in progress', () => {
    const active = { ...signingIn(), tabId: 5, pageTabId: 6 };
    expect(reduce(active, { type: 'open', queue: ['a@x.com'], now: 9 })).toBe(active);
    const err = reduce(active, { type: 'tabClosed' })!;
    expect(inProgress(err)).toBe(true);
    expect(reduce(err, { type: 'open', queue: ['a@x.com'], now: 9 })).toBe(err);
    // Finished or not started: a fresh run that keeps both tabs for reuse.
    const done: WizardState = { ...active, phase: 'done' };
    expect(inProgress(done)).toBe(false);
    expect(reduce(done, { type: 'open', queue: ['a@x.com'], now: 9 })).toEqual({
      phase: 'confirm', queue: ['a@x.com'], current: 0, completed: [], startedAt: 9, tabId: 5, pageTabId: 6,
    });
  });

  it('records the reorder page tab', () => {
    expect(reduce(opened(), { type: 'pageOpened', tabId: 11 })?.pageTabId).toBe(11);
  });

  it('expires an active wizard after 30 idle minutes', () => {
    const s = { ...signingIn(), startedAt: 0 };
    expect(isExpired(s, WIZARD_TTL_MS - 1)).toBe(false);
    expect(reduce(s, { type: 'expire', now: WIZARD_TTL_MS - 1 })).toBe(s);
    const e = reduce(s, { type: 'expire', now: WIZARD_TTL_MS })!;
    expect(e).toMatchObject({ phase: 'error', errorKind: 'expired' });
    expect(isActive(e)).toBe(false);
    expect(inProgress(e)).toBe(true);
    // Retry picks it up again.
    expect(reduce(e, { type: 'retry' })?.phase).toBe('signing-out');
  });

  it('activity pushes expiry back; inactive phases never expire', () => {
    const s = { ...signingIn(), startedAt: 0 };
    const touched = reduce(s, { type: 'touch', now: 20 * 60_000 })!;
    expect(touched.lastActivityAt).toBe(20 * 60_000);
    expect(reduce(touched, { type: 'expire', now: WIZARD_TTL_MS + 1 })).toBe(touched);
    expect(reduce(touched, { type: 'expire', now: 50 * 60_000 })?.phase).toBe('error');
    const c = { ...opened(), startedAt: 0 };
    expect(reduce(c, { type: 'expire', now: 10 * WIZARD_TTL_MS })).toBe(c);
    expect(reduce(c, { type: 'touch', now: 5 })).toBe(c);
  });

  it('continue while signing out keeps accounts that won’t sign out, and never asks for them', () => {
    // Chrome sync keeps a@x.com signed in. Queue is b, a, c.
    let s = reduce(opened(), { type: 'begin' })!;
    s = reduce(s, { type: 'accounts', accounts: signedIn('a@x.com') })!;
    expect(s.phase).toBe('signing-out');
    s = reduce(s, { type: 'continue', accounts: signedIn('a@x.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 0, completed: ['a@x.com'], kept: ['a@x.com'] });
    // a@x.com is already there, so b@x.com is added to the session rather than chosen first.
    expect(tabUrlFor(s)).toBe(signInUrl('b@x.com', false));
    // Ticks with only the kept account change nothing.
    expect(reduce(s, { type: 'accounts', accounts: signedIn('a@x.com') })).toEqual(s);
    // b signs in: a (kept) is passed over, c is next.
    s = reduce(s, { type: 'accounts', accounts: signedIn('a@x.com', 'b@x.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 2, completed: ['a@x.com', 'b@x.com'] });
    s = reduce(s, { type: 'accounts', accounts: signedIn('a@x.com', 'b@x.com', 'c@x.com') })!;
    expect(s).toMatchObject({ phase: 'done', completed: ['a@x.com', 'b@x.com', 'c@x.com'] });
  });

  it('continue skips kept accounts at the head of the queue, and finishes when all are kept', () => {
    const out = reduce(opened(), { type: 'begin' })!;
    const s = reduce(out, { type: 'continue', accounts: signedIn('b@x.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 1 });
    const all = reduce(out, { type: 'continue', accounts: signedIn('b@x.com', 'a@x.com', 'c@x.com') })!;
    expect(all.phase).toBe('done');
    // Nobody left signed in: same as a normal sign-out.
    expect(reduce(out, { type: 'continue', accounts: signedOut('a@x.com') })).toMatchObject({
      phase: 'signing-in', current: 0, completed: [], kept: undefined,
    });
  });

  it('continue only applies while signing out; starting over forgets kept accounts', () => {
    const c = opened();
    expect(reduce(c, { type: 'continue', accounts: [] })).toBe(c);
    const s = signingIn();
    expect(reduce(s, { type: 'continue', accounts: signedIn('a@x.com') })).toBe(s);
    let k = reduce(reduce(c, { type: 'begin' }), { type: 'continue', accounts: signedIn('a@x.com') })!;
    k = reduce(k, { type: 'accounts', accounts: signedIn('a@x.com', 'c@x.com') })!;
    expect(k.phase).toBe('error');
    expect(reduce(k, { type: 'retry' })).toMatchObject({ phase: 'signing-out', completed: [], kept: undefined });
  });

  it('empty queue finishes right after sign-out', () => {
    let s = reduce(null, { type: 'open', queue: [], now: 0 });
    s = reduce(s, { type: 'begin' });
    s = reduce(s, { type: 'accounts', accounts: [] });
    expect(s?.phase).toBe('done');
  });
});

describe('reorder list', () => {
  // Google lists b and a signed in, c signed out. z@x.com is in the saved order but Google forgot it.
  const accounts: Account[] = [...signedIn('b@x.com', 'a@x.com'), ...signedOut('c@x.com')];

  it('includes signed-out accounts, in the user order, and leaves out ones Google no longer lists', () => {
    expect(reorderQueue(['c@x.com', 'z@x.com', 'a@x.com'], accounts)).toEqual(['c@x.com', 'a@x.com', 'b@x.com']);
    expect(reorderQueue([], signedOut('d@x.com'))).toEqual(['d@x.com']);
  });

  it('signs a signed-out account back in as part of the flow', () => {
    // Queue a, c (signed out before the reorder), b.
    let s = reduce(null, { type: 'open', queue: reorderQueue(['a@x.com', 'c@x.com', 'b@x.com'], accounts), now: 0 })!;
    expect(s.queue).toEqual(['a@x.com', 'c@x.com', 'b@x.com']);
    s = reduce(s, { type: 'begin' })!;
    s = reduce(s, { type: 'accounts', accounts: signedOut('a@x.com', 'b@x.com', 'c@x.com') })!;
    s = reduce(s, { type: 'accounts', accounts: signedIn('a@x.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 1 });
    expect(tabUrlFor(s)).toBe(signInUrl('c@x.com', false));
    s = reduce(s, { type: 'accounts', accounts: signedIn('a@x.com', 'c@x.com') })!;
    s = reduce(s, { type: 'accounts', accounts: signedIn('a@x.com', 'c@x.com', 'b@x.com') })!;
    expect(s).toMatchObject({ phase: 'done', completed: ['a@x.com', 'c@x.com', 'b@x.com'] });
  });

  it('removed accounts are left out of the reorder, and signing one in anyway is a wrong account', () => {
    let s = reduce(opened(), { type: 'queue', queue: ['b@x.com', 'c@x.com'] })!;
    expect(s).toMatchObject({ phase: 'confirm', queue: ['b@x.com', 'c@x.com'] });
    s = reduce(s, { type: 'begin' })!;
    s = reduce(s, { type: 'accounts', accounts: [] })!;
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com') })!;
    expect(tabUrlFor(s)).toBe(signInUrl('c@x.com', false));
    const wrong = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com', 'a@x.com') })!;
    expect(wrong).toMatchObject({ phase: 'error', errorKind: 'wrong-account' });
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com', 'c@x.com') })!;
    expect(s).toMatchObject({ phase: 'done', current: 2, completed: ['b@x.com', 'c@x.com'] });
  });

  it('only edits the list before starting, and cleans it', () => {
    const c = reduce(opened(), { type: 'queue', queue: ['A@x.com', 'a@x.com', 'junk'] })!;
    expect(c.queue).toEqual(['a@x.com']);
    expect(reduce(opened(), { type: 'queue', queue: [] })?.queue).toEqual([]);
    const s = signingIn();
    expect(reduce(s, { type: 'queue', queue: ['a@x.com'] })).toBe(s);
    expect(reduce(null, { type: 'queue', queue: ['a@x.com'] })).toBeNull();
  });

  it('adds a removed account back at its place', () => {
    const all = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'];
    expect(restoreToQueue(['a@x.com', 'd@x.com'], all, 'c@x.com')).toEqual(['a@x.com', 'c@x.com', 'd@x.com']);
    expect(restoreToQueue(['c@x.com'], all, 'a@x.com')).toEqual(['a@x.com', 'c@x.com']);
    expect(restoreToQueue([], all, 'b@x.com')).toEqual(['b@x.com']);
    expect(restoreToQueue(['b@x.com'], all, 'b@x.com')).toEqual(['b@x.com']);
  });
});

describe('adding a new account', () => {
  const all = ['a@x.com', 'b@x.com', 'c@x.com'];

  it('lowercases a typed email and puts it last', () => {
    expect(addToQueue(['a@x.com'], '  New@Example.COM ', all)).toEqual({
      ok: true, queue: ['a@x.com', 'new@example.com'], email: 'new@example.com', restored: false,
    });
  });

  it('rejects duplicates and things that are not emails', () => {
    expect(addToQueue(['a@x.com'], 'A@X.com', all)).toEqual({ ok: false, reason: 'duplicate' });
    expect(addToQueue(['a@x.com', 'new@example.com'], 'new@example.com', all)).toEqual({ ok: false, reason: 'duplicate' });
    for (const bad of ['', 'new', 'new@', '@example.com', 'new@example', 'a b@example.com']) {
      expect(addToQueue(['a@x.com'], bad, all)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('typing a removed account adds it back at its place', () => {
    expect(addToQueue(['a@x.com', 'c@x.com'], 'B@x.com', all)).toEqual({
      ok: true, queue: ['a@x.com', 'b@x.com', 'c@x.com'], email: 'b@x.com', restored: true,
    });
  });

  it('marks queue emails Google does not list as added, and forgets them when removed', () => {
    let s = reduce(opened(), { type: 'queue', queue: ['b@x.com', 'new@example.com', 'a@x.com'], known: QUEUE })!;
    expect(s).toMatchObject({ queue: ['b@x.com', 'new@example.com', 'a@x.com'], added: ['new@example.com'] });
    s = reduce(s, { type: 'queue', queue: ['b@x.com', 'a@x.com'], known: QUEUE })!;
    expect(s.added).toBeUndefined();
    expect('added' in s).toBe(false);
  });

  it('asks for the new email as a step, and moves on when Google reports it signed in', () => {
    let s = reduce(opened(), { type: 'queue', queue: ['b@x.com', 'new@example.com', 'a@x.com'], known: QUEUE })!;
    s = reduce(s, { type: 'begin' })!;
    s = reduce(s, { type: 'accounts', accounts: signedOut('a@x.com', 'b@x.com') })!;
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 1 });
    expect(tabUrlFor(s)).toBe(signInUrl('new@example.com', false));
    // Another account instead of the new one is still a wrong account.
    expect(reduce(s, { type: 'accounts', accounts: signedIn('b@x.com', 'a@x.com') })).toMatchObject({
      phase: 'error', errorKind: 'wrong-account',
    });
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com', 'new@example.com') })!;
    expect(s).toMatchObject({ phase: 'signing-in', current: 2, completed: ['b@x.com', 'new@example.com'] });
    s = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com', 'new@example.com', 'a@x.com') })!;
    expect(s).toMatchObject({ phase: 'done', added: ['new@example.com'] });
  });

  it('places a new account in the saved order at its spot in the reorder', () => {
    // Google's list appended n@x.com to the saved order; the user put it second.
    const queue = ['b@x.com', 'n@x.com', 'a@x.com'];
    expect(placeAdded(['a@x.com', 'b@x.com', 'z@x.com', 'n@x.com'], queue, ['n@x.com'])).toEqual([
      'a@x.com', 'b@x.com', 'n@x.com', 'z@x.com',
    ]);
    // First in the reorder: before the next one that is in the order.
    expect(placeAdded(['a@x.com', 'n@x.com'], ['n@x.com', 'a@x.com'], ['n@x.com'])).toEqual(['n@x.com', 'a@x.com']);
    // Nothing else from the reorder in the order: last.
    expect(placeAdded(['z@x.com'], ['n@x.com'], ['n@x.com'])).toEqual(['z@x.com', 'n@x.com']);
    // Two new ones keep their relative order; emails not in the reorder are ignored.
    expect(placeAdded(['a@x.com', 'm@x.com', 'n@x.com'], ['n@x.com', 'm@x.com', 'a@x.com'], ['m@x.com', 'n@x.com', 'q@x.com']))
      .toEqual(['n@x.com', 'm@x.com', 'a@x.com']);
  });
});

describe('wizard URLs', () => {
  it('builds sign-in URLs with URLSearchParams', () => {
    const first = new URL(signInUrl('a+b@x.com', true));
    expect(first.origin + first.pathname).toBe('https://accounts.google.com/AccountChooser');
    expect(first.searchParams.get('Email')).toBe('a+b@x.com');
    expect(first.searchParams.get('continue')).toBe('https://myaccount.google.com/');
    const later = new URL(signInUrl('x&y=1@x.com', false, 'https://mail.google.com/mail/'));
    expect(later.pathname).toBe('/AddSession');
    expect(later.searchParams.get('Email')).toBe('x&y=1@x.com');
    expect(later.searchParams.get('continue')).toBe('https://mail.google.com/mail/');
    expect([...later.searchParams.keys()]).toEqual(['Email', 'continue']);
  });

  it('signs out with a continue page on accounts.google.com, so the wizard keeps its tab', () => {
    const url = new URL(LOGOUT_URL);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/Logout');
    expect(url.searchParams.get('continue')).toBe('https://accounts.google.com/');
  });

  it('tabUrlFor follows the phase', () => {
    expect(tabUrlFor(null)).toBeNull();
    expect(tabUrlFor(opened())).toBeNull();
    expect(tabUrlFor(reduce(opened(), { type: 'begin' }))).toBe(LOGOUT_URL);
    const s = signingIn();
    expect(tabUrlFor(s)).toBe(signInUrl('b@x.com', true));
    const second = reduce(s, { type: 'accounts', accounts: signedIn('b@x.com') });
    expect(tabUrlFor(second)).toBe(signInUrl('a@x.com', false));
    // After a skip at the start, the first real sign-in still uses AccountChooser.
    expect(tabUrlFor(reduce(s, { type: 'skip' }))).toBe(signInUrl('a@x.com', true));
  });

  it('stepChanged detects phase or account changes only', () => {
    const s = signingIn();
    expect(stepChanged(null, s)).toBe(true);
    expect(stepChanged(s, { ...s, completed: ['z@x.com'] })).toBe(false);
    expect(stepChanged(s, { ...s, current: 1 })).toBe(true);
    expect(stepChanged(s, null)).toBe(false);
  });
});
