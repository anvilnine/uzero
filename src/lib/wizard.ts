// Pure state machine for the real reorder wizard, plus the Google URLs it opens.
// Side effects (tabs, storage) live in the background; this file only decides.
import type { Account, WizardErrorKind, WizardState } from './types';
import { normalizeEmail, sanitizeEmails } from './accounts';

export type WizardEvent =
  | { type: 'open'; queue: readonly string[]; now: number }
  | { type: 'begin' }
  /**
   * The user edited the list before starting (removed, added back or typed in accounts). Only in
   * confirm. `known`: emails Google lists; anything else in the queue is a new account.
   */
  | { type: 'queue'; queue: readonly string[]; known?: readonly string[] }
  /** Fresh ListAccounts result (a tick). */
  | { type: 'accounts'; accounts: readonly Account[] }
  | { type: 'skip' }
  | { type: 'retry' }
  /** "Continue anyway" while signing out: `accounts` is the latest list; whoever is still in stays. */
  | { type: 'continue'; accounts: readonly Account[] }
  | { type: 'tabOpened'; tabId: number }
  | { type: 'tabClosed' }
  /** The reorder.html tab was opened (or found again). */
  | { type: 'pageOpened'; tabId: number }
  /** Time check: an idle wizard expires so pin mode doesn't stay off all session. */
  | { type: 'expire'; now: number }
  /** User activity in the wizard's Google tab. */
  | { type: 'touch'; now: number };

const ACTIVE = new Set<WizardState['phase']>(['signing-out', 'signing-in']);

/** Signing out or in: pin mode is paused. */
export function isActive(s: WizardState | null): boolean {
  return !!s && ACTIVE.has(s.phase);
}

/** A reorder the user started and hasn't finished or cancelled (includes errors waiting for Retry/Skip). */
export function inProgress(s: WizardState | null): boolean {
  return isActive(s) || s?.phase === 'error';
}

/** An active wizard with no progress or user action for this long expires. */
export const WIZARD_TTL_MS = 30 * 60_000;

export function lastActivity(s: WizardState): number {
  return s.lastActivityAt ?? s.startedAt;
}

export function isExpired(s: WizardState | null, now: number): boolean {
  return !!s && isActive(s) && now - lastActivity(s) >= WIZARD_TTL_MS;
}

function fail(s: WizardState, errorKind: WizardErrorKind, error: string, patch: Partial<WizardState> = {}): WizardState {
  return { ...s, ...patch, phase: 'error', errorKind, error };
}

const signedInEmails = (accounts: readonly Account[]) =>
  accounts.filter((a) => !a.signedOut && a.index >= 0).sort((a, b) => a.index - b.index).map((a) => a.email);

/** Move to queue[current] (past any kept accounts), or finish. */
function signInAt(s: WizardState, current: number): WizardState {
  const kept = new Set(s.kept);
  while (current < s.queue.length && kept.has(s.queue[current]!)) current++;
  if (current >= s.queue.length) {
    return { ...s, phase: 'done', current: s.queue.length, error: undefined, errorKind: undefined };
  }
  return { ...s, phase: 'signing-in', current, error: undefined, errorKind: undefined };
}

/**
 * `expected` is signed in already and sits right behind the earlier targets that are signed in,
 * in queue order, with nothing else ahead of it. Happens after a Skip, or a "wrong" account that
 * turned out to be a later one in the queue.
 */
function inPlace(s: WizardState, signedIn: readonly string[], expected: string): boolean {
  const pos = signedIn.indexOf(expected);
  if (pos < 0) return false;
  const live = new Set(signedIn);
  const earlier = s.queue.slice(0, s.current).filter((e) => live.has(e));
  const ahead = signedIn.slice(0, pos);
  return ahead.length === earlier.length && ahead.every((e, i) => e === earlier[i]);
}

/** Progress so far matches the target order, so we can resume instead of starting over. */
function onTrack(s: WizardState): boolean {
  const done = s.queue.slice(0, s.current);
  return s.completed.length === done.length && s.completed.every((e, i) => e === done[i]);
}

/** Back to the start: sign out of everything. */
function signOut(s: WizardState): WizardState {
  return { ...s, phase: 'signing-out', current: 0, completed: [], kept: undefined, error: undefined, errorKind: undefined };
}

export function reduce(state: WizardState | null, ev: WizardEvent): WizardState | null {
  if (ev.type === 'open') {
    // A reorder in progress is never reset from here; the caller just shows its page again.
    if (state && inProgress(state)) return state;
    const fresh: WizardState = { phase: 'confirm', queue: sanitizeEmails(ev.queue), current: 0, completed: [], startedAt: ev.now };
    // Keep the Google tab and the reorder page from an earlier run so they get reused.
    if (state?.tabId !== undefined) fresh.tabId = state.tabId;
    if (state?.pageTabId !== undefined) fresh.pageTabId = state.pageTabId;
    return fresh;
  }
  if (!state) return null;

  switch (ev.type) {
    case 'pageOpened':
      return { ...state, pageTabId: ev.tabId };

    case 'expire':
      if (!isExpired(state, ev.now)) return state;
      return fail(state, 'expired', 'Nothing happened for 30 minutes, so Uzero paused the reorder.');

    case 'touch':
      return isActive(state) ? { ...state, lastActivityAt: ev.now } : state;

    case 'queue': {
      if (state.phase !== 'confirm') return state;
      const queue = sanitizeEmails(ev.queue);
      const known = new Set(ev.known ?? queue);
      const added = queue.filter((e) => !known.has(e));
      const next: WizardState = { ...state, queue };
      if (added.length > 0) next.added = added;
      else delete next.added;
      return next;
    }

    case 'begin':
      if (state.phase !== 'confirm' && state.phase !== 'error') return state;
      return signOut(state);

    case 'tabOpened':
      return { ...state, tabId: ev.tabId };

    case 'tabClosed':
      if (!isActive(state)) return { ...state, tabId: undefined };
      return fail(state, 'tab-closed', 'The Google tab was closed.', { tabId: undefined });

    case 'skip':
      if (state.phase !== 'error' && state.phase !== 'signing-in') return state;
      return signInAt(state, state.current + 1);

    case 'retry':
      if (state.phase !== 'error') return state;
      // Resume when the order so far is right; otherwise sign out and start over.
      if (state.current > 0 && onTrack(state)) return signInAt(state, state.current);
      return signOut(state);

    case 'continue': {
      if (state.phase !== 'signing-out') return state;
      // Some accounts won't sign out (Chrome sync puts its own back). Count them as already there.
      const still = signedInEmails(ev.accounts);
      return signInAt({ ...state, completed: still, kept: still.length > 0 ? still : undefined }, 0);
    }

    case 'accounts': {
      const signedIn = signedInEmails(ev.accounts);
      if (state.phase === 'signing-out') {
        if (signedIn.length > 0) return state;
        return signInAt({ ...state, completed: [], kept: undefined }, 0);
      }
      if (state.phase !== 'signing-in') return state;

      const expected = state.queue[state.current];
      const before = new Set(state.completed);
      const added = signedIn.filter((e) => !before.has(e));
      const wrong = added.filter((e) => e !== expected);
      if (wrong.length > 0) {
        return fail(state, 'wrong-account', `Signed in as ${wrong[0]}, expected ${expected ?? 'nothing'}.`, {
          completed: signedIn,
        });
      }
      if (expected === undefined) return state;
      if (added.includes(expected)) {
        return signInAt({ ...state, completed: signedIn }, state.current + 1);
      }
      // Already signed in (e.g. after Skip): move on if it is in the right place, else say so.
      if (signedIn.includes(expected)) {
        if (inPlace(state, signedIn, expected)) return signInAt({ ...state, completed: signedIn }, state.current + 1);
        return fail(
          state,
          'out-of-order',
          `${expected} is already signed in, but Google lists it at #${signedIn.indexOf(expected) + 1}.`,
          { completed: signedIn },
        );
      }
      return state;
    }
  }
}

/**
 * Everyone the reorder signs back in by default: each account Google lists, signed in or
 * signed out (still in its account chooser), in the user's order. Accounts Google no longer
 * lists at all are left out. Unordered accounts go last, as in the popup.
 */
export function reorderQueue(order: readonly string[], accounts: readonly Account[]): string[] {
  const listed = new Set(accounts.map((a) => a.email));
  const out = order.filter((e) => listed.has(e));
  for (const a of accounts) if (!out.includes(a.email)) out.push(a.email);
  return sanitizeEmails(out);
}

/**
 * Put a removed account back into the list at its place in `all` (the full default list):
 * right after the nearest earlier account that is still in the list, or first.
 */
export function restoreToQueue(queue: readonly string[], all: readonly string[], email: string): string[] {
  if (queue.includes(email)) return [...queue];
  const at = all.indexOf(email);
  if (at < 0) return [...queue, email];
  for (let i = at - 1; i >= 0; i--) {
    const pos = queue.indexOf(all[i]!);
    if (pos >= 0) return [...queue.slice(0, pos + 1), email, ...queue.slice(pos + 1)];
  }
  return [email, ...queue];
}

export type AddResult =
  | { ok: true; queue: string[]; email: string; restored: boolean }
  | { ok: false; reason: 'invalid' | 'duplicate' };

/**
 * Add a typed email to the list. Lowercased and checked lightly. One already in the list is
 * refused; a removed account goes back to its place; anything else goes last.
 */
export function addToQueue(queue: readonly string[], input: string, all: readonly string[]): AddResult {
  const email = normalizeEmail(input);
  if (!email) return { ok: false, reason: 'invalid' };
  if (queue.includes(email)) return { ok: false, reason: 'duplicate' };
  if (all.includes(email)) return { ok: true, queue: restoreToQueue(queue, all, email), email, restored: true };
  return { ok: true, queue: [...queue, email], email, restored: false };
}

/**
 * Put newly signed-in accounts the user typed in at their place in the saved order: right after
 * the nearest earlier account of the reorder that is in the order, else before the nearest later
 * one, else last. Other accounts keep their places.
 */
export function placeAdded(order: readonly string[], queue: readonly string[], emails: readonly string[]): string[] {
  const moving = new Set(emails.filter((e) => queue.includes(e)));
  const out = order.filter((e) => !moving.has(e));
  for (const email of queue) {
    if (!moving.has(email)) continue;
    const at = queue.indexOf(email);
    const before = queue.slice(0, at).reverse().find((e) => out.includes(e));
    const after = queue.slice(at + 1).find((e) => out.includes(e));
    if (before !== undefined) out.splice(out.indexOf(before) + 1, 0, email);
    else if (after !== undefined) out.splice(out.indexOf(after), 0, email);
    else out.push(email);
  }
  return out;
}

/** Sign out of every account, then stay on accounts.google.com so the wizard keeps its tab. */
export const LOGOUT_URL = (() => {
  const url = new URL('https://accounts.google.com/Logout');
  url.searchParams.set('continue', 'https://accounts.google.com/');
  return url.href;
})();
export const CONTINUE_URL = 'https://myaccount.google.com/';

/** First sign-in uses AccountChooser, later ones AddSession (adds to the existing session). */
export function signInUrl(email: string, first: boolean, continueUrl = CONTINUE_URL): string {
  const url = new URL(first ? 'https://accounts.google.com/AccountChooser' : 'https://accounts.google.com/AddSession');
  url.searchParams.set('Email', email);
  url.searchParams.set('continue', continueUrl);
  return url.href;
}

/** Where the wizard's Google tab should be for this state, or null when it needs no tab. */
export function tabUrlFor(s: WizardState | null): string | null {
  if (!s) return null;
  if (s.phase === 'signing-out') return LOGOUT_URL;
  if (s.phase === 'signing-in') {
    const email = s.queue[s.current];
    return email ? signInUrl(email, s.completed.length === 0) : null;
  }
  return null;
}

/** The tab needs to move when the step changed (phase or account). */
export function stepChanged(prev: WizardState | null, next: WizardState | null): boolean {
  if (!next) return false;
  return !prev || prev.phase !== next.phase || prev.current !== next.current;
}
