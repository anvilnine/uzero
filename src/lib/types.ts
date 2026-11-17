// Shared contract between background, popup, options and the reorder wizard.
// Changing a shape here means updating both the background handlers and the UI.

/** One Google account signed in (or remembered) in this browser profile. */
export interface Account {
  /** Lower-cased email. Primary key everywhere. */
  email: string;
  name: string;
  /** Avatar URL from Google (lh3.googleusercontent.com). May be empty. */
  photo: string;
  /** Google's own authuser index (/u/N). -1 when signed out. */
  index: number;
  /** Signed out but still remembered in Google's account chooser. */
  signedOut: boolean;
}

export type LabelColor =
  | 'slate'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'blue'
  | 'violet'
  | 'pink';

export interface AccountMeta {
  /** Short user label, e.g. "Work". Max 24 chars. */
  label?: string;
  color?: LabelColor;
}

export type SafariGuideMode = 'window' | 'overlay';

export interface Prefs {
  /** Where Safari shows the real reorder guide. Other browsers ignore this preference. */
  safariGuideMode: SafariGuideMode;
  /** The user's preferred order, by email. First = their "default". */
  order: string[];
  meta: Record<string, AccountMeta>;
  /** Pin mode: rewrite Google links that name no account to the first signed-in account in `order`. */
  pinEnabled: boolean;
  /** Per-service override: service id -> email. Wins over the default while that account is signed in. */
  serviceDefaults: Record<string, string>;
  /** Services the user turned off for pin mode. */
  disabledServices: string[];
}

export const DEFAULT_PREFS: Prefs = {
  safariGuideMode: 'window',
  order: [],
  meta: {},
  pinEnabled: false,
  serviceDefaults: {},
  disabledServices: [],
};

export type FetchStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; at: number }
  | { kind: 'error'; message: string; at: number };

export interface AppState {
  /** Accounts as Google reports them, sorted by Google index (signed out last). */
  accounts: Account[];
  prefs: Prefs;
  status: FetchStatus;
  /** Safari Pin eligibility or installation error, separate from account discovery. */
  pinError?: string | null;
  wizard: WizardState | null;
}

/** Public info about a Google service the extension knows how to route. */
export interface ServiceInfo {
  id: string;
  name: string;
  /** Example landing URL used for "Open in account" shortcuts. */
  home: string;
}

// ---- Real reorder wizard ----------------------------------------------------

export type WizardPhase =
  /** Waiting for the user to confirm on the wizard page. */
  | 'confirm'
  /** Sign-out tab is open; waiting until Google reports zero signed-in accounts. */
  | 'signing-out'
  /** Sign-in tab open for `queue[current]`; waiting until it shows up signed in. */
  | 'signing-in'
  | 'done'
  | 'error';

/** Why the wizard stopped in `error`. Older saved states have none (treat as 'wrong-account'). */
export type WizardErrorKind =
  /** Google added an account other than the expected one. */
  | 'wrong-account'
  /** The expected account is signed in already, but not at its place in the order. */
  | 'out-of-order'
  /** The user closed the wizard's Google tab. */
  | 'tab-closed'
  /** Nothing happened for a long time; pin mode was turned back on. */
  | 'expired';

export interface WizardState {
  phase: WizardPhase;
  /** Target order, by email. */
  queue: string[];
  /** Index into `queue` of the account being signed in now. */
  current: number;
  /** Emails confirmed signed in so far, in the order Google reports them. */
  completed: string[];
  /**
   * Accounts that stayed signed in when the user chose "Continue anyway" during sign-out
   * (e.g. Chrome sync's own account). They count as already present and are never asked for.
   */
  kept?: string[];
  /** Id of the Google tab the wizard opened, if any. */
  tabId?: number;
  /** Id of the reorder.html tab, so "Make it real" can focus it instead of opening another. */
  pageTabId?: number;
  error?: string;
  errorKind?: WizardErrorKind;
  startedAt: number;
  /** Last progress or user action. A wizard idle for 30 min expires and pin mode comes back. */
  lastActivityAt?: number;
}

// ---- Messages (UI -> background) -------------------------------------------

export type Request =
  | { type: 'getState' }
  | { type: 'refresh' }
  | { type: 'savePrefs'; patch: Partial<Prefs> }
  /** Reload the active tab as `email`, if it is a supported Google page. */
  | { type: 'switchActiveTab'; email: string }
  /** Open a service home page as `email` in a new tab. */
  | { type: 'openService'; serviceId: string; email: string }
  | { type: 'listServices' }
  /** Can the active tab be switched? Returns its service id or null. */
  | { type: 'activeTabService' }
  /**
   * Open the reorder page. While a reorder runs, focuses its page and keeps its state.
   * `panel`: the steps show in the browser's side panel, so no reorder tab is opened.
   */
  | { type: 'wizardOpen'; queue: string[]; panel?: boolean }
  /** Before starting: the edited list of accounts to sign back in, in order. May be empty. */
  | { type: 'wizardQueue'; queue: string[] }
  | { type: 'wizardBegin' }
  | { type: 'wizardSkip' }
  | { type: 'wizardRetry' }
  /** Stop waiting for sign-out: go on to sign-in, keeping accounts that are still signed in. */
  | { type: 'wizardContinue' }
  /** Send the wizard's Google tab back to the current step's page (opens a new tab if needed). */
  | { type: 'wizardReopen' }
  /** Bring the wizard's Google tab and its window to the front. */
  | { type: 'wizardFocusTab' }
  | { type: 'wizardCancel' };

export interface ResponseMap {
  getState: AppState;
  refresh: AppState;
  savePrefs: Prefs;
  switchActiveTab: { ok: boolean; reason?: string };
  openService: { ok: boolean };
  listServices: ServiceInfo[];
  activeTabService: { serviceId: string | null; email: string | null };
  wizardOpen: WizardState;
  wizardQueue: WizardState;
  wizardBegin: WizardState;
  wizardSkip: WizardState;
  wizardRetry: WizardState;
  wizardContinue: WizardState;
  wizardReopen: WizardState;
  wizardFocusTab: { ok: boolean };
  wizardCancel: null;
}

export type Response<T extends Request['type']> = ResponseMap[T];

/** Envelope the background sends back so errors cross the message boundary. */
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/** storage.local keys */
export const KEY_PREFS = 'local:prefs';
export const KEY_ACCOUNTS = 'local:accounts';
/** storage.session keys (cleared on browser restart) */
export const KEY_STATUS = 'session:status';
export const KEY_WIZARD = 'session:wizard';
/** Hosts where pin mode is paused after a redirect loop: host -> paused until (ms). */
export const KEY_LOOP_PAUSES = 'session:loopPauses';
