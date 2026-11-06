// Fake background for design review in a plain browser tab.
// Scenarios via query string, e.g. popup.html?mock=error
//   mock = loading | empty | error | signing-out | signing-in | wrong-account | tab-closed | expired | done
//          | in-progress (popup: a reorder is running)
//   tab  = none (active tab is not a Google page)
import type { Api } from './api';
import type { Account, AppState, Prefs, Request, ServiceInfo, WizardState } from './types';

type Listener = (s: AppState) => void;

const ACCOUNTS: Account[] = [
  {
    email: 'me@zonilyjame.dev',
    name: 'Zonily Jame',
    photo: '',
    index: 0,
    signedOut: false,
  },
  {
    email: 'zonily@anvilnine.com',
    name: 'Zonily Jame',
    photo: '',
    index: 1,
    signedOut: false,
  },
  {
    email: 'hello@critalarm.app',
    name: 'Crit Alarm',
    photo: '',
    index: 2,
    signedOut: false,
  },
  {
    email: 'team@namescout.app',
    name: 'Namescout',
    photo: '',
    index: 3,
    signedOut: false,
  },
  {
    email: 'old@zonilyjame.dev',
    name: 'Zonily Jame',
    photo: '',
    index: -1,
    signedOut: true,
  },
];

const PREFS: Prefs = {
  order: [
    'zonily@anvilnine.com',
    'me@zonilyjame.dev',
    'hello@critalarm.app',
    'team@namescout.app',
    'old@zonilyjame.dev',
  ],
  meta: {
    'zonily@anvilnine.com': { label: 'Work', color: 'blue' },
    'me@zonilyjame.dev': { label: 'Personal', color: 'green' },
    'hello@critalarm.app': { label: 'Support', color: 'orange' },
    'team@namescout.app': { label: 'Team', color: 'violet' },
  },
  pinEnabled: true,
  serviceDefaults: { youtube: 'me@zonilyjame.dev', photos: 'me@zonilyjame.dev' },
  disabledServices: ['maps'],
};

const SERVICES: ServiceInfo[] = [
  { id: 'gmail', name: 'Gmail', home: 'https://mail.google.com/mail/' },
  { id: 'calendar', name: 'Calendar', home: 'https://calendar.google.com/calendar/' },
  { id: 'drive', name: 'Drive', home: 'https://drive.google.com/drive/' },
  { id: 'docs', name: 'Docs', home: 'https://docs.google.com/document/' },
  { id: 'sheets', name: 'Sheets', home: 'https://docs.google.com/spreadsheets/' },
  { id: 'slides', name: 'Slides', home: 'https://docs.google.com/presentation/' },
  { id: 'meet', name: 'Meet', home: 'https://meet.google.com/' },
  { id: 'photos', name: 'Photos', home: 'https://photos.google.com/' },
  { id: 'youtube', name: 'YouTube', home: 'https://www.youtube.com/' },
  { id: 'maps', name: 'Maps', home: 'https://www.google.com/maps' },
  { id: 'cloud', name: 'Cloud Console', home: 'https://console.cloud.google.com/' },
  { id: 'myaccount', name: 'Google Account', home: 'https://myaccount.google.com/' },
];

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const scenario = params.get('mock') ?? '';
const tabNone = params.get('tab') === 'none';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

let state: AppState = {
  accounts: scenario === 'empty' ? [] : clone(ACCOUNTS),
  prefs: scenario === 'empty' ? { ...clone(PREFS), order: [], meta: {} } : clone(PREFS),
  status:
    scenario === 'error'
      ? { kind: 'error', message: 'Google did not answer. Check your connection.', at: Date.now() }
      : { kind: 'ok', at: Date.now() },
  wizard: null,
};

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  const snap = clone(state);
  for (const fn of listeners) fn(snap);
}

function setWizard(w: WizardState | null) {
  state = { ...state, wizard: w };
  emit();
}

function signedInOrder(): Account[] {
  return state.accounts.filter((a) => !a.signedOut).sort((a, b) => a.index - b.index);
}

function wizardStart(queue: string[]): WizardState {
  return { phase: 'confirm', queue: [...queue], current: 0, completed: [], startedAt: Date.now() };
}

/** Simulate the user signing out, then signing in one account at a time. */
function advance() {
  const w = state.wizard;
  if (!w) return;
  if (w.phase === 'signing-out') {
    state.accounts = state.accounts.map((a) => ({ ...a, index: -1, signedOut: true }));
    setWizard({ ...w, phase: 'signing-in', current: 0 });
    timer = setTimeout(advance, 4200);
    return;
  }
  if (w.phase === 'signing-in') {
    const email = w.queue[w.current]!;
    const nextIndex = signedInOrder().length;
    state.accounts = state.accounts.map((a) =>
      a.email === email ? { ...a, index: nextIndex, signedOut: false } : a,
    );
    const completed = [...w.completed, email];
    const current = w.current + 1;
    if (current >= w.queue.length) {
      setWizard({ ...w, completed, current, phase: 'done' });
    } else {
      setWizard({ ...w, completed, current });
      timer = setTimeout(advance, 4200);
    }
  }
}

function presetWizard(): WizardState | null {
  const queue = PREFS.order.slice(0, 4);
  const base = wizardStart(queue);
  switch (scenario) {
    case 'confirm':
      return base;
    case 'signing-out':
      return { ...base, phase: 'signing-out', tabId: 7 };
    case 'signing-in':
      state.accounts = state.accounts.map((a) =>
        a.email === queue[0] ? { ...a, index: 0 } : { ...a, index: -1, signedOut: true },
      );
      return { ...base, phase: 'signing-in', current: 1, completed: [queue[0]!], tabId: 7 };
    case 'wrong-account':
      return {
        ...base,
        phase: 'error',
        errorKind: 'wrong-account',
        current: 1,
        completed: [queue[0]!],
        tabId: 7,
        error: 'You signed in as team@namescout.app.',
      };
    case 'tab-closed':
      return { ...base, phase: 'error', errorKind: 'tab-closed', current: 1, completed: [queue[0]!], error: 'The Google tab was closed.' };
    case 'expired':
      return {
        ...base,
        phase: 'error',
        errorKind: 'expired',
        current: 1,
        completed: [queue[0]!],
        tabId: 7,
        error: 'Nothing happened for 30 minutes, so Uzero paused the reorder.',
      };
    case 'done': {
      // Chrome sync pinned the personal account back to the top.
      const finalOrder = [queue[1]!, queue[0]!, queue[2]!, queue[3]!];
      state.accounts = state.accounts.map((a) => {
        const i = finalOrder.indexOf(a.email);
        return { ...a, index: i, signedOut: i < 0 };
      });
      return { ...base, phase: 'done', current: 4, completed: finalOrder, tabId: 7 };
    }
    default:
      return null;
  }
}

if (typeof location !== 'undefined' && (location.pathname.includes('reorder') || location.pathname.includes('sidepanel'))) {
  state.wizard = presetWizard() ?? wizardStart(PREFS.order.slice(0, 4));
} else if (scenario === 'in-progress') {
  state.wizard = { ...wizardStart(PREFS.order.slice(0, 4)), phase: 'signing-in', current: 1, completed: [PREFS.order[0]!], tabId: 7 };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handle(req: Request): Promise<unknown> {
  if (scenario === 'loading') await new Promise(() => {});
  await delay(scenario === 'slow' ? 1200 : 60);
  switch (req.type) {
    case 'getState':
    case 'refresh':
      return clone(state);
    case 'savePrefs': {
      state = { ...state, prefs: { ...state.prefs, ...req.patch } };
      emit();
      return clone(state.prefs);
    }
    case 'switchActiveTab':
      return tabNone ? { ok: false, reason: 'This tab is not a Google page.' } : { ok: true };
    case 'openService':
      return { ok: true };
    case 'listServices':
      return clone(SERVICES);
    case 'activeTabService':
      return tabNone
        ? { serviceId: null, email: null }
        : { serviceId: 'gmail', email: 'me@zonilyjame.dev' };
    case 'wizardOpen': {
      const cur = state.wizard;
      if (cur && (cur.phase === 'signing-out' || cur.phase === 'signing-in' || cur.phase === 'error')) return clone(cur);
      const w = wizardStart(req.queue);
      setWizard(w);
      return w;
    }
    case 'wizardBegin': {
      if (!state.wizard) throw new Error('No reorder in progress.');
      const w: WizardState = { ...state.wizard, phase: 'signing-out', tabId: 7 };
      setWizard(w);
      if (timer) clearTimeout(timer);
      timer = setTimeout(advance, 2600);
      return w;
    }
    case 'wizardSkip': {
      const w = state.wizard;
      if (!w) throw new Error('No reorder in progress.');
      if (timer) clearTimeout(timer);
      const current = w.current + 1;
      const next: WizardState =
        current >= w.queue.length
          ? { ...w, current, phase: 'done', error: undefined, errorKind: undefined }
          : { ...w, current, phase: 'signing-in', error: undefined, errorKind: undefined };
      setWizard(next);
      if (next.phase === 'signing-in') timer = setTimeout(advance, 4200);
      return next;
    }
    case 'wizardRetry': {
      const w = state.wizard;
      if (!w) throw new Error('No reorder in progress.');
      const next: WizardState = { ...w, phase: 'signing-in', error: undefined, errorKind: undefined, tabId: 7 };
      setWizard(next);
      if (timer) clearTimeout(timer);
      timer = setTimeout(advance, 4200);
      return next;
    }
    case 'wizardContinue': {
      const w = state.wizard;
      if (!w) throw new Error('No reorder in progress.');
      if (w.phase !== 'signing-out') return clone(w);
      // Pretend Chrome sync kept the first account signed in.
      const kept = signedInOrder().slice(0, 1).map((a) => a.email);
      if (timer) clearTimeout(timer);
      const current = Math.max(0, w.queue.findIndex((e) => !kept.includes(e)));
      const next: WizardState = { ...w, phase: 'signing-in', current, completed: kept, kept };
      setWizard(next);
      timer = setTimeout(advance, 4200);
      return next;
    }
    case 'wizardReopen': {
      if (!state.wizard) throw new Error('No reorder in progress.');
      const next: WizardState = { ...state.wizard, tabId: 7 };
      setWizard(next);
      return next;
    }
    case 'wizardFocusTab':
      return { ok: !!state.wizard };
    case 'wizardCancel': {
      if (timer) clearTimeout(timer);
      setWizard(null);
      return null;
    }
  }
}

export const mockApi: Api = {
  send: (req) => handle(req) as never,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
