// Pure state machine for the real reorder wizard, plus the Google URLs it opens.
// Side effects (tabs, storage) live in the background; this file only decides.
import type { Account, WizardErrorKind, WizardState } from './types';
import { sanitizeEmails } from './accounts';

export type WizardEvent =
  | { type: 'open'; queue: readonly string[]; now: number }
  | { type: 'begin' }
  /** Fresh ListAccounts result (a tick). */
  | { type: 'accounts'; accounts: readonly Account[] }
  | { type: 'skip' }
  | { type: 'retry' }
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

/** Move to queue[current], or finish. */
function signInAt(s: WizardState, current: number): WizardState {
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
      return fail(state, 'expired', 'Nothing happened for 30 minutes, so Lineup paused the reorder.');

    case 'touch':
      return isActive(state) ? { ...state, lastActivityAt: ev.now } : state;

    case 'begin':
      if (state.phase !== 'confirm' && state.phase !== 'error') return state;
      return { ...state, phase: 'signing-out', current: 0, completed: [], error: undefined, errorKind: undefined };

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
      return { ...state, phase: 'signing-out', current: 0, completed: [], error: undefined, errorKind: undefined };

    case 'accounts': {
      const signedIn = signedInEmails(ev.accounts);
      if (state.phase === 'signing-out') {
        if (signedIn.length > 0) return state;
        return signInAt({ ...state, completed: [] }, 0);
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

export const LOGOUT_URL = 'https://accounts.google.com/Logout';
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
