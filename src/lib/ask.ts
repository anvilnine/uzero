// After a reorder that worked: ask once how it went, then point to the store review or the
// feedback form, and offer share links. Everything here stays on this device. The rating is
// never sent anywhere; opening a link is the only thing that leaves the browser, and only when
// the user clicks it.

/**
 * Store review pages, through short links on uzero.app. The real targets live in the site's
 * public/_redirects, so they can change without an extension update.
 * TODO: until the listings are live these land on the uzero.app home page.
 * An empty value hides the button.
 */
export const REVIEW_URLS: Record<Store, string> = {
  chrome: 'https://uzero.app/review/chrome',
  edge: 'https://uzero.app/review/edge',
  firefox: 'https://uzero.app/review/firefox',
};

/**
 * Feedback form, through a short link on uzero.app (see the site's public/_redirects).
 * TODO: lands on uzero.app/support/ until the forms.zonily.cloud form exists.
 */
export const FEEDBACK_URL = 'https://uzero.app/feedback';

export const SITE_URL = 'https://uzero.app/';
export const SHARE_TEXT = 'Uzero puts my Google accounts in my order. No more opening links in the wrong account.';

export type Store = 'chrome' | 'edge' | 'firefox';

export interface AskState {
  /** 1-5 once the user picked a rating. They are never asked again after that. */
  rating?: number;
  /** Times the user pressed "Not now". */
  dismissals: number;
  /** Last "Not now", ms since epoch. */
  dismissedAt?: number;
}

export const ASK_KEY = 'local:ask';
export const EMPTY_ASK: AskState = { dismissals: 0 };
/** After "Not now", wait this long before the next successful reorder can ask again. */
export const ASK_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
/** Two "Not now" answers and Uzero stops asking for good. */
export const ASK_MAX_DISMISSALS = 2;
/** 4 and 5 count as happy. */
export const HAPPY_FROM = 4;

export function sanitizeAsk(input: unknown): AskState {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: AskState = {
    dismissals: Number.isInteger(raw.dismissals) && (raw.dismissals as number) > 0 ? Math.min(raw.dismissals as number, 99) : 0,
  };
  if (Number.isInteger(raw.rating) && (raw.rating as number) >= 1 && (raw.rating as number) <= 5) out.rating = raw.rating as number;
  if (typeof raw.dismissedAt === 'number' && Number.isFinite(raw.dismissedAt)) out.dismissedAt = raw.dismissedAt;
  return out;
}

/** Ask only when the user has never rated, has not said "Not now" twice, and is past the snooze. */
export function shouldAsk(s: AskState, now: number): boolean {
  if (s.rating) return false;
  if (s.dismissals >= ASK_MAX_DISMISSALS) return false;
  if (s.dismissedAt && now - s.dismissedAt < ASK_SNOOZE_MS) return false;
  return true;
}

export function rate(s: AskState, rating: number): AskState {
  return sanitizeAsk({ ...s, rating });
}

export function dismiss(s: AskState, now: number): AskState {
  return { ...s, dismissals: s.dismissals + 1, dismissedAt: now };
}

/**
 * Where a rating sends the user. Both paths stay open so no store review is gated on the
 * rating: a happy user sees the store first and feedback second, an unhappy user the reverse.
 */
export function route(rating: number): 'review' | 'feedback' {
  return rating >= HAPPY_FROM ? 'review' : 'feedback';
}

/** Which store this build came from. Edge runs the Chrome build, so check the user agent. */
export function detectStore(browserName: string, userAgent: string): Store | null {
  if (browserName === 'firefox') return 'firefox';
  if (browserName === 'edge') return 'edge';
  if (browserName === 'chrome') return /\bEdg\//.test(userAgent) ? 'edge' : 'chrome';
  return null;
}

export const STORE_NAMES: Record<Store, string> = {
  chrome: 'Chrome Web Store',
  edge: 'Edge Add-ons',
  firefox: 'Firefox Add-ons',
};

export interface ShareLink {
  id: 'x' | 'bluesky' | 'linkedin' | 'reddit';
  label: string;
  href: string;
}

export function shareLinks(url = SITE_URL, text = SHARE_TEXT): ShareLink[] {
  const e = encodeURIComponent;
  return [
    { id: 'x', label: 'X', href: `https://x.com/intent/post?text=${e(text)}&url=${e(url)}` },
    { id: 'bluesky', label: 'Bluesky', href: `https://bsky.app/intent/compose?text=${e(`${text} ${url}`)}` },
    { id: 'linkedin', label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}` },
    { id: 'reddit', label: 'Reddit', href: `https://www.reddit.com/submit?url=${e(url)}&title=${e(text)}` },
  ];
}

// ---- storage -----------------------------------------------------------------
// Extension pages use browser.storage.local. The design preview (plain tab) falls back to localStorage.

const LS_KEY = 'uzero:ask';

function hasExtStorage(): boolean {
  return typeof browser !== 'undefined' && !!browser.runtime?.id && !!browser.storage?.local;
}

export async function loadAsk(): Promise<AskState> {
  try {
    if (hasExtStorage()) {
      const got = await browser.storage.local.get(LS_KEY);
      return sanitizeAsk(got[LS_KEY]);
    }
    return sanitizeAsk(JSON.parse(localStorage.getItem(LS_KEY) ?? 'null'));
  } catch {
    return { ...EMPTY_ASK };
  }
}

export async function saveAsk(s: AskState): Promise<void> {
  try {
    if (hasExtStorage()) await browser.storage.local.set({ [LS_KEY]: s });
    else localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    // Losing this only means the question may show again. Not worth an error on a success screen.
  }
}
