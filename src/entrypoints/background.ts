// Uzero background: message router, account refresh, pin-mode rules, commands, wizard tab.
// Startup does no work beyond registering listeners; everything runs on events.
import { browser, type Browser, type PublicPath } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { Account, AppState, Envelope, Prefs, Request, ResponseMap, WizardState } from '@/lib/types';
import { fetchAccounts, indexByEmail } from '@/lib/accounts';
import { fetchAccountsViaTab, isGoogleTabUrl, NoGoogleTabError } from '@/lib/safariAccounts';
import {
  SAFARI_PIN_UNAVAILABLE, LOOP_MAX_HOSTS, LOOP_PAUSE_MS, LOOP_RULE_BASE_ID, buildRules, loopAllowRules, namesAccount, originRule,
  pinnedHosts, recordHit,
} from '@/lib/dnr';
import { authorizeSafariGuide, GUIDE_AUTHORIZE, guideRunning, removeSafariGuide, safariGuideTabRemoved, showSafariGuide } from '@/lib/safariGuide';
import { isTrustedSender, parseRequest } from '@/lib/messages';
import { currentEmail, switchableServiceId, toAccount } from '@/lib/rewrite';
import { ACCOUNT_HOSTS, SERVICES, serviceById, toServiceInfo } from '@/lib/services';
import {
  accountsItem, applyPrefsPatch, loopPausesItem, mergeOrder, prefsItem, sameJson, statusItem, wizardItem,
} from '@/lib/store';
import {
  WIZARD_TTL_MS, isActive, isExpired, lastActivity, reduce, signInUrl, stepChanged, tabUrlFor, type WizardEvent,
} from '@/lib/wizard';

type DnrRule = Browser.declarativeNetRequest.Rule;

const REFRESH_ALARM = 'uzero-refresh';
const WIZARD_ALARM = 'uzero-wizard-expiry';
const LOOP_ALARM = 'uzero-loop-pauses';
const REFRESH_PERIOD_MIN = 15;
const DEBOUNCE_MS = 1500;
/** An ok status is rewritten at most this often when nothing changed (each write wakes every open page). */
const STATUS_REFRESH_MS = 60_000;
/** Accounts older than this get a quiet refresh when a tab lands on a pinned /u/N. */
const PIN_STALE_MS = 5 * 60_000;
const ORIGIN_RULE_ID = 1;
const ACCOUNTS_HOST = 'accounts.google.com';
/** Pages the wizard's Google tab may show. Anywhere else, the user took the tab over. */
const WIZARD_HOSTS: ReadonlySet<string> = new Set(ACCOUNT_HOSTS);
/** Google's home page, where Logout can land instead. Only counts while signing out. */
const LOGOUT_LANDING = 'www.google.com';
const REORDER_PAGE = '/reorder.html' as PublicPath;
const PANEL_PAGE = '/sidepanel.html' as PublicPath;
// BROWSER (not FIREFOX): vitest defines env flags as strings, so "false" would be truthy there.
const IS_FIREFOX = import.meta.env.BROWSER === 'firefox';
const IS_SAFARI = import.meta.env.BROWSER === 'safari';
/** Host of our own pages. Chrome: the extension id. Safari: a per-install UUID, never runtime.id. */
const OWN_HOST = new URL(browser.runtime.getURL('/')).host;

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(onMessage);
  browser.runtime.onInstalled.addListener(() => void onBrowserStart());
  browser.runtime.onStartup.addListener(() => void onBrowserStart());
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === REFRESH_ALARM) void refresh();
    if (a.name === WIZARD_ALARM) void wizardStep({ type: 'expire', now: Date.now() });
    if (a.name === LOOP_ALARM) void sweepLoopPauses();
  });
  browser.commands.onCommand.addListener((cmd) => void onCommand(cmd));
  browser.tabs.onUpdated.addListener(onTabUpdated);
  browser.tabs.onRemoved.addListener(async (tabId) => {
    if (IS_SAFARI) {
      if (await safariGuideTabRemoved(tabId)) {
        await wizardLock(async () => {
          const w = await wizardItem.getValue();
          if (w?.pageTabId === tabId) await wizardItem.setValue({ ...w, pageTabId: undefined });
        });
        return;
      }
      // Only tabs previously observed in normal windows may drive a wizard or refresh.
      if (!accountsTabs.has(tabId) && !tabUrls.has(tabId)) return;
    }
    void onTabRemoved(tabId);
  });
  if (IS_FIREFOX) installFirefoxOriginFallback();
  // Remove rules persisted by an older Safari build on every worker start, before any refresh.
  if (IS_SAFARI) void syncRules();
});

// ---- helpers -----------------------------------------------------------------

/** Run async jobs one after another (no interleaved read-modify-write). */
function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}

const prefsLock = serial();
const wizardLock = serial();
const rulesLock = serial();
const loopLock = serial();

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function getState(): Promise<AppState> {
  const [accounts, prefs, status, stored] = await Promise.all([
    accountsItem.getValue(), prefsItem.getValue(), statusItem.getValue(), wizardItem.getValue(),
  ]);
  // An abandoned wizard expires here too, so pin mode comes back as soon as any page looks.
  const wizard = isExpired(stored, Date.now()) ? await wizardStep({ type: 'expire', now: Date.now() }) : stored;
  return { accounts, prefs, status: IS_SAFARI && prefs.pinEnabled
    ? { kind: 'error', message: status.kind === 'error' ? `${status.message} ${SAFARI_PIN_UNAVAILABLE}` : SAFARI_PIN_UNAVAILABLE, at: Date.now() } : status, wizard };
}

function updatePrefs(fn: (prev: Prefs) => Prefs): Promise<{ prev: Prefs; next: Prefs }> {
  return prefsLock(async () => {
    const prev = await prefsItem.getValue();
    const next = fn(prev);
    if (!sameJson(prev, next)) await prefsItem.setValue(next);
    return { prev, next };
  });
}

// ---- startup, alarm, rules ---------------------------------------------------

async function onBrowserStart(): Promise<void> {
  const prefs = await prefsItem.getValue();
  await syncAlarm(prefs.pinEnabled);
  await refresh();
  // Rules may come from an older version; rebuild once even if nothing changed.
  await syncRules();
}

async function syncAlarm(pinEnabled: boolean): Promise<void> {
  const existing = await browser.alarms.get(REFRESH_ALARM);
  if (pinEnabled && !existing) await browser.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MIN });
  if (!pinEnabled && existing) await browser.alarms.clear(REFRESH_ALARM);
}

/** Replace all dynamic rules in one atomic call. Pin mode pauses while the wizard runs. */
function syncRules(): Promise<void> {
  return rulesLock(async () => {
    try {
      const [prefs, accounts, wizard] = await Promise.all([
        prefsItem.getValue(), accountsItem.getValue(), wizardItem.getValue(),
      ]);
      const paused = isActive(wizard) || IS_SAFARI;
      const rules = paused ? [] : buildRules(prefs, accounts);
      pinHosts = paused ? new Map() : pinnedHosts(prefs, accounts);
      const existing = await browser.declarativeNetRequest.getDynamicRules();
      if (IS_SAFARI) {
        const session = await browser.declarativeNetRequest.getSessionRules();
        if (session.length) await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: session.map((r) => r.id) });
      }
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map((r) => r.id),
        ...(IS_SAFARI ? {} : { addRules: rules as unknown as DnrRule[] }),
      });
    } catch (e) {
      console.error('[uzero] rules', e);
      await clearRules();
    }
  });
}

/** Fail closed: with no rules, links open where Google sends them, never at a stale /u/N. */
async function clearRules(): Promise<void> {
  pinHosts = new Map();
  try {
    const existing = await browser.declarativeNetRequest.getDynamicRules();
    if (existing.length) {
      await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id) });
    }
  } catch (e) {
    console.error('[uzero] clearing rules', e);
  }
}

let originReady: Promise<void> | null = null;

/** Session rule that makes ListAccounts see a google.com Origin. Installed once per worker life. */
function ensureOriginRule(): Promise<void> {
  // Firefox uses the webRequest fallback; its gecko id isn't a valid initiator domain.
  if (IS_FIREFOX) return Promise.resolve();
  originReady ??= browser.declarativeNetRequest
    .updateSessionRules({
      removeRuleIds: [ORIGIN_RULE_ID],
      addRules: [originRule(IS_SAFARI ? OWN_HOST : browser.runtime.id, ORIGIN_RULE_ID) as unknown as DnrRule],
    })
    .catch((e) => {
      originReady = null;
      // Not fatal: the fetch then fails with 403 and the UI shows the error.
      console.warn('[uzero] origin rule', e);
    });
  return originReady;
}

/** Firefox: DNR initiatorDomains doesn't match moz-extension:// UUIDs, so set Origin here too. */
function installFirefoxOriginFallback(): void {
  const own = browser.runtime.getURL('/');
  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const d = details as typeof details & { originUrl?: string };
      if (d.tabId !== -1 || !d.originUrl?.startsWith(own)) return {};
      const requestHeaders = (d.requestHeaders ?? []).filter((h) => h.name.toLowerCase() !== 'origin');
      requestHeaders.push({ name: 'Origin', value: 'https://www.google.com' });
      return { requestHeaders };
    },
    { urls: ['https://accounts.google.com/ListAccounts*'] },
    ['blocking', 'requestHeaders'] as unknown as Browser.webRequest.OnBeforeSendHeadersOptions[],
  );
}

// ---- loop breaker ------------------------------------------------------------------
// If Google keeps sending a tab back to a URL without an account, pin mode would bounce it forever.
// 3 jumps of one tab from a URL without an account to the pinned one, on one host within 3 s,
// pause pin there for 10 minutes. Reloads and in-app navigation never count.

/** Pinned host -> index, as installed by syncRules. Null until computed in this worker's life. */
let pinHosts: Map<string, number> | null = null;
/** `${tabId} ${host}` -> recent navigation times. Memory only. */
const loopHits = new Map<string, number[]>();
/** Last URL seen per tab (Uzero's hosts only). Memory only. */
const tabUrls = new Map<number, string>();
const ACCOUNT_IN_URL = /[?&]authuser=|\/u\/\d/;

async function currentPinHosts(): Promise<Map<string, number>> {
  if (pinHosts) return pinHosts;
  const [prefs, accounts, wizard] = await Promise.all([
    prefsItem.getValue(), accountsItem.getValue(), wizardItem.getValue(),
  ]);
  pinHosts = IS_SAFARI || isActive(wizard) ? new Map() : pinnedHosts(prefs, accounts);
  return pinHosts;
}

/** `url` replaced `prev` in a tab. Counts a hit when pin just added the account to a bare URL. */
async function checkLoop(tabId: number, prev: string | undefined, url: string): Promise<void> {
  if (!ACCOUNT_IN_URL.test(url)) return;
  const host = hostOf(url);
  if (!host) return;
  const n = (await currentPinHosts()).get(host);
  if (n === undefined || !namesAccount(url, n)) return;
  void refreshIfStale();
  if (!prev || hostOf(prev) !== host || ACCOUNT_IN_URL.test(prev)) return;
  const key = `${tabId} ${host}`;
  const { hits, loop } = recordHit(loopHits.get(key) ?? [], Date.now());
  if (!loop) {
    loopHits.set(key, hits);
    return;
  }
  loopHits.delete(key);
  console.warn(`[uzero] ${host} keeps redirecting; pin is paused there for 10 minutes.`);
  await updateLoopPauses((p) => ({ ...p, [host]: Date.now() + LOOP_PAUSE_MS }));
}

/** A tab just opened a pinned /u/N: if the account list is old, check that N is still right. */
async function refreshIfStale(): Promise<void> {
  const status = await statusItem.getValue();
  if (status.kind === 'ok' && Date.now() - status.at > PIN_STALE_MS) scheduleRefresh(0);
}

function sweepLoopPauses(): Promise<void> {
  return updateLoopPauses((p) => p);
}

/** Drop expired pauses, apply `fn`, then replace the loop-breaker session rules. */
function updateLoopPauses(fn: (p: Record<string, number>) => Record<string, number>): Promise<void> {
  return loopLock(async () => {
    const now = Date.now();
    const live = Object.fromEntries(Object.entries(await loopPausesItem.getValue()).filter(([, t]) => t > now));
    const next = fn(live);
    await loopPausesItem.setValue(next);
    const existing = await browser.declarativeNetRequest.getSessionRules();
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existing
        .map((r) => r.id)
        .filter((id) => id >= LOOP_RULE_BASE_ID && id < LOOP_RULE_BASE_ID + LOOP_MAX_HOSTS),
      addRules: IS_SAFARI ? [] : loopAllowRules(Object.keys(next)) as unknown as DnrRule[],
    });
    const until = Object.values(next);
    if (until.length) await browser.alarms.create(LOOP_ALARM, { when: Math.min(...until) + 500 });
    else await browser.alarms.clear(LOOP_ALARM);
  }).catch((e) => console.error('[uzero] loop guard', e));
}

// ---- refresh -------------------------------------------------------------------

let inflight: Promise<void> | null = null;

/** Fetch accounts. Concurrent callers share one request. */
function refresh(): Promise<void> {
  inflight ??= doRefresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doRefresh(): Promise<void> {
  const status = await statusItem.getValue();
  if (status.kind !== 'ok') await statusItem.setValue({ kind: 'loading' });

  let accounts: Account[];
  try {
    if (IS_SAFARI) {
      accounts = await fetchAccountsViaTab();
    } else {
      await ensureOriginRule();
      accounts = await fetchAccounts();
    }
  } catch (e) {
    // Safari with no Google tab open: keep showing the last list we read instead of an error.
    if (IS_SAFARI && e instanceof NoGoogleTabError && (await accountsItem.getValue()).length) {
      if (status.kind !== 'ok') await statusItem.setValue({ kind: 'ok', at: Date.now() });
      return;
    }
    await statusItem.setValue({ kind: 'error', message: errorMessage(e), at: Date.now() });
    return;
  }

  const prevAccounts = await accountsItem.getValue();
  const accountsChanged = !sameJson(prevAccounts, accounts);
  if (accountsChanged) await accountsItem.setValue(accounts);
  const { prev, next } = await updatePrefs((p) => ({ ...p, order: mergeOrder(p.order, accounts) }));
  // Wizard pages refresh every 3 s; an unchanged ok status is only rewritten once a minute.
  const now = Date.now();
  if (status.kind !== 'ok' || accountsChanged || now - status.at >= STATUS_REFRESH_MS) {
    await statusItem.setValue({ kind: 'ok', at: now });
  }

  await wizardStep({ type: 'accounts', accounts });
  if (accountsChanged || !sameJson(prev.order, next.order)) await syncRules();
}

let debounce: ReturnType<typeof setTimeout> | undefined;

function scheduleRefresh(ms = DEBOUNCE_MS): void {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = undefined;
    void refresh();
  }, ms);
}

/** Tabs seen on accounts.google.com; refresh again once they leave it. Memory only (best effort). */
const accountsTabs = new Set<number>();

function onTabUpdated(tabId: number, info: Browser.tabs.OnUpdatedInfo, tab: Browser.tabs.Tab): void {
  if (IS_SAFARI && tab.incognito !== false) return;
  if (info.status === undefined && info.url === undefined) return;
  const onAccounts = hostOf(tab.url) === ACCOUNTS_HOST;
  // Safari reads accounts through Google tabs, so a Google page finishing a load is the refresh tick.
  if (IS_SAFARI && !onAccounts && info.status === 'complete' && isGoogleTabUrl(tab.url)) scheduleRefresh();
  if (onAccounts) {
    accountsTabs.add(tabId);
    scheduleRefresh();
  } else if (accountsTabs.has(tabId) && info.status === 'complete') {
    accountsTabs.delete(tabId);
    scheduleRefresh();
  }
  // The rest needs the URL, which host permissions only expose on Uzero's own hosts.
  const prevUrl = tabUrls.get(tabId);
  if (!tab.url) {
    tabUrls.delete(tabId);
    return;
  }
  tabUrls.set(tabId, tab.url);
  if (tab.url !== prevUrl) void checkLoop(tabId, prevUrl, tab.url);
  if (info.status === 'complete') {
    // Wizard tick: its tab finished a page. The user is busy signing in, so the wizard isn't idle.
    void wizardItem.getValue().then((w) => {
      if (!w || !isActive(w) || w.tabId !== tabId) return;
      void wizardStep({ type: 'touch', now: Date.now() });
      if (IS_SAFARI && onAccounts) void syncSafariGuide(w, w);
      if (!onAccounts) scheduleRefresh(); // e.g. myaccount after sign-in
    });
  }
}

async function onTabRemoved(tabId: number): Promise<void> {
  if (accountsTabs.delete(tabId)) scheduleRefresh();
  for (const key of loopHits.keys()) if (key.startsWith(`${tabId} `)) loopHits.delete(key);
  tabUrls.delete(tabId);
  const w = await wizardItem.getValue();
  if (w?.tabId === tabId) await wizardStep({ type: 'tabClosed' });
}

// ---- tabs: switch / open -------------------------------------------------------

async function activeTab(): Promise<Browser.tabs.Tab | undefined> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return IS_SAFARI && tab?.incognito !== false ? undefined : tab;
}

async function switchActiveTab(email: string): Promise<ResponseMap['switchActiveTab']> {
  const tab = await activeTab();
  // tab.url is only visible for hosts we have permission for, i.e. Google pages.
  if (tab?.id === undefined || !tab.url) return { ok: false, reason: 'This tab is not a Google page.' };
  const index = indexByEmail(await accountsItem.getValue()).get(email);
  if (index === undefined) return { ok: false, reason: 'That account is not signed in.' };
  const url = toAccount(tab.url, index);
  if (!url) return { ok: false, reason: 'Uzero cannot switch this page.' };
  if (url !== tab.url) await browser.tabs.update(tab.id, { url });
  return { ok: true };
}

/** Safari must never let tabs.create choose the currently focused (possibly private) window.
 * Window privacy is immutable; revalidate existence/privacy immediately before creation. */
async function createNormalTab(options: Parameters<typeof browser.tabs.create>[0]): Promise<Browser.tabs.Tab | undefined> {
  if (!IS_SAFARI) return browser.tabs.create(options);
  const windows = await browser.windows.getAll();
  for (const candidate of windows) {
    if (candidate.id === undefined || candidate.incognito !== false || candidate.type !== 'normal') continue;
    const normal = await browser.windows.get(candidate.id).catch(() => undefined);
    if (normal?.id !== candidate.id || normal.incognito !== false) continue;
    // Explicit id: closing this window produces an error, never a fallback to the private window.
    const tab = await browser.tabs.create({ ...options, windowId: normal.id }).catch(() => undefined);
    if (tab) return tab;
  }
  return undefined;
}

async function openService(serviceId: string, email: string): Promise<ResponseMap['openService']> {
  const service = serviceById(serviceId);
  if (!service) return { ok: false };
  const index = indexByEmail(await accountsItem.getValue()).get(email);
  const url =
    index === undefined
      ? signInUrl(email, true, service.home) // signed out: let Google ask for this account
      : (toAccount(service.home, index) ?? service.home);
  const created = await createNormalTab({ url });
  if (!created) throw new Error('Open a normal Safari window to use Uzero.');
  return { ok: true };
}

async function activeTabService(): Promise<ResponseMap['activeTabService']> {
  const tab = await activeTab();
  if (!tab?.url) return { serviceId: null, email: null };
  return {
    serviceId: switchableServiceId(tab.url),
    email: currentEmail(tab.url, await accountsItem.getValue()),
  };
}

async function onCommand(cmd: string): Promise<void> {
  const m = /^switch-([1-4])$/.exec(cmd);
  if (!m) return;
  const prefs = await prefsItem.getValue();
  const email = prefs.order[Number(m[1]) - 1];
  if (email) await switchActiveTab(email);
}

// ---- wizard ----------------------------------------------------------------------

/**
 * Reduce, apply tab side effects, persist. State lives in storage.session so a restarted worker resumes.
 * Pin rules pause while the wizard is active, so rebuild them when that flips.
 * An idle wizard expires first (see WIZARD_TTL_MS); any change while active counts as activity.
 */
function wizardStep(ev: WizardEvent, opts: { reopen?: boolean } = {}): Promise<WizardState | null> {
  return wizardLock(async () => {
    const now = Date.now();
    const prev = await wizardItem.getValue();
    let next = reduce(reduce(prev, { type: 'expire', now }), ev);
    if (sameJson(prev, next) && !opts.reopen) return prev;
    if (next && isActive(next)) next = { ...next, lastActivityAt: now };
    next = await wizardEffects(prev, next, !!opts.reopen);
    await wizardItem.setValue(next);
    if (IS_SAFARI) await syncSafariGuide(prev, next);
    if (isActive(prev) !== isActive(next)) void syncRules();
    if (isActive(next)) {
      await browser.alarms.create(WIZARD_ALARM, { when: lastActivity(next!) + WIZARD_TTL_MS + 1000 });
    } else if (isActive(prev)) {
      await browser.alarms.clear(WIZARD_ALARM);
    }
    return next;
  });
}

/** Presentation failures are visible, but never roll back an already completed Google step. */
async function syncSafariGuide(prev: WizardState | null, next: WizardState | null): Promise<void> {
  try {
    if (!next || (next.phase !== 'confirm' && !guideRunning(next))) {
      await removeSafariGuide(prev);
      return;
    }
    if (prev?.tabId !== undefined && prev.tabId !== next.tabId) await removeSafariGuide(prev, false);
    await showSafariGuide((await prefsItem.getValue()).safariGuideMode, next);
  } catch (e) {
    await statusItem.setValue({ kind: 'error', message: `Safari guide: ${errorMessage(e)}. Reopen the reorder from Uzero.`, at: Date.now() });
  }
}

async function focusWindow(windowId: number | undefined): Promise<void> {
  if (windowId === undefined || windowId < 0) return;
  await browser.windows.update(windowId, { focused: true }).catch(() => undefined);
}

function isWizardPage(url: string | undefined, signingOut: boolean): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (WIZARD_HOSTS.has(u.hostname)) return true;
    return signingOut && u.hostname === LOGOUT_LANDING && u.pathname === '/';
  } catch {
    return false;
  }
}

/**
 * The wizard's Google tab, but only while it still shows a Google account page
 * (or, with `signingOut`, Google's home page, where Logout may land).
 */
async function ownGoogleTab(tabId: number | undefined, signingOut = false): Promise<Browser.tabs.Tab | undefined> {
  if (tabId === undefined) return undefined;
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  return tab && (!IS_SAFARI || tab.incognito === false) && isWizardPage(tab.url ?? tab.pendingUrl, signingOut) ? tab : undefined;
}

/** Point the wizard's Google tab at `url`: reuse it if it is still ours, else open a new one. */
async function showGoogleTab(
  tabId: number | undefined,
  url: string,
  focus: boolean,
  signingOut: boolean,
): Promise<number | undefined> {
  const own = await ownGoogleTab(tabId, signingOut);
  if (own?.id !== undefined) {
    try {
      await browser.tabs.update(own.id, { url, active: true });
      if (focus) await focusWindow(own.windowId);
      return own.id;
    } catch {
      /* gone meanwhile: open a new one */
    }
  }
  const created = await createNormalTab({ url, active: true });
  if (!created) return undefined;
  if (focus) await focusWindow(created.windowId);
  return created.id;
}

async function wizardEffects(
  prev: WizardState | null,
  next: WizardState | null,
  reopen: boolean,
): Promise<WizardState | null> {
  if (!next) return next;
  // The tab may still be on Logout's landing page when the step moves on.
  const signingOut = prev?.phase === 'signing-out' || next.phase === 'signing-out';
  if (next.phase === 'done') {
    // Close the Google tab only if the user didn't take it somewhere else.
    const own = await ownGoogleTab(next.tabId, signingOut);
    if (own?.id !== undefined) await browser.tabs.remove(own.id).catch(() => undefined);
    return { ...next, tabId: undefined };
  }
  const url = tabUrlFor(next);
  if (!url || (!stepChanged(prev, next) && !reopen)) return next;
  const tabId = await showGoogleTab(next.tabId, url, reopen, signingOut);
  // No verified normal window: keep the previous step pending instead of silently advancing.
  if (IS_SAFARI && tabId === undefined) return prev;
  return { ...next, tabId };
}

async function wizardCancel(): Promise<null> {
  await wizardLock(async () => {
    const w = await wizardItem.getValue();
    if (IS_SAFARI) await removeSafariGuide(w);
    const own = await ownGoogleTab(w?.tabId, w?.phase === 'signing-out');
    if (own?.id !== undefined) await browser.tabs.remove(own.id).catch(() => undefined);
    await wizardItem.setValue(null);
    await browser.alarms.clear(WIZARD_ALARM);
  });
  await syncRules();
  return null;
}

/** Focus the reorder page if it is still open, else open it. Returns its tab id. */
async function showReorderPage(pageTabId: number | undefined): Promise<number | undefined> {
  const page = browser.runtime.getURL(REORDER_PAGE);
  if (pageTabId !== undefined) {
    const tab = await browser.tabs.get(pageTabId).catch(() => undefined);
    const at = tab?.url ?? tab?.pendingUrl;
    if (tab?.id !== undefined && (!IS_SAFARI || tab.incognito === false) && at?.startsWith(page)) {
      try {
        await browser.tabs.update(tab.id, { active: true });
        await focusWindow(tab.windowId);
        return tab.id;
      } catch {
        /* closed meanwhile */
      }
    }
  }
  return (await createNormalTab({ url: page, active: true }))?.id;
}

/**
 * Open the reorder page. While a reorder is in progress its state is kept (never reset mid-sign-in)
 * and its page is focused instead of opening a second one. `fromPage` is the reorder tab that asked.
 * With `panel`, the steps live in the side panel, so no reorder tab is opened.
 */
async function wizardOpen(queue: string[], fromPage: number | undefined, panel = false): Promise<WizardState> {
  let state = (await wizardStep({ type: 'open', queue, now: Date.now() }))!;
  if (isActive(state)) state = (await wizardStep({ type: 'touch', now: Date.now() }))!;
  if (IS_SAFARI) {
    const mode = (await prefsItem.getValue()).safariGuideMode;
    if (mode === 'window') {
      const id = await showSafariGuide(mode, state, true);
      if (id !== undefined) state = (await wizardStep({ type: 'pageOpened', tabId: id }))!;
      return state;
    }
    if (guideRunning(state)) {
      await showSafariGuide(mode, state, true);
      await wizardFocusTab();
      return state;
    }
    // Overlay selection still confirms in an extension page, without opening any Google URL.
  }
  if (panel && !IS_SAFARI) return state;
  const pageTabId = fromPage ?? (await showReorderPage(state.pageTabId));
  if (pageTabId !== undefined && pageTabId !== state.pageTabId) {
    state = (await wizardStep({ type: 'pageOpened', tabId: pageTabId }))!;
  }
  return state;
}

async function wizardAction(type: 'begin' | 'skip' | 'retry'): Promise<WizardState> {
  const state = await wizardStep({ type });
  if (!state) throw new Error('No reorder in progress.');
  // A fresh read right away: after "begin" the user may already be signed out.
  if (isActive(state)) scheduleRefresh();
  return state;
}

/**
 * "Continue anyway": sign-out is stuck because some accounts stay signed in (Chrome sync puts its
 * own back). Look once more, then go on to sign-in with those accounts counted as already there.
 */
async function wizardContinue(): Promise<WizardState> {
  await refresh();
  const status = await statusItem.getValue();
  if (status.kind === 'error') throw new Error('Couldn’t check your Google accounts. Try again.');
  const state = await wizardStep({ type: 'continue', accounts: await accountsItem.getValue() });
  if (!state) throw new Error('No reorder in progress.');
  if (isActive(state)) scheduleRefresh();
  return state;
}

/** "Reopen sign-in": send the Google tab back to the current step's page, even if the step didn't change. */
async function wizardReopen(): Promise<WizardState> {
  const state = await wizardStep({ type: 'touch', now: Date.now() }, { reopen: true });
  if (!state) throw new Error('No reorder in progress.');
  return state;
}

/** "Go to the Google tab": focus it and its window, or reopen it when it is gone. */
async function wizardFocusTab(): Promise<ResponseMap['wizardFocusTab']> {
  const w = await wizardItem.getValue();
  if (!isActive(w)) return { ok: false };
  const own = await ownGoogleTab(w!.tabId, w!.phase === 'signing-out');
  if (own?.id === undefined) {
    await wizardReopen();
    return { ok: true };
  }
  await browser.tabs.update(own.id, { active: true });
  await focusWindow(own.windowId);
  return { ok: true };
}

// ---- messages -----------------------------------------------------------------------

async function handle(req: Request, sender: Browser.runtime.MessageSender): Promise<unknown> {
  // A web-accessible iframe has extension origin, but only the active guide may use its narrow API.
  const webParent = IS_SAFARI && sender.tab && !sender.tab.url?.startsWith(browser.runtime.getURL('/'));
  if (webParent || (sender.frameId !== undefined && sender.frameId > 0)) {
    const allowed = new Set(['getState', 'refresh', 'wizardSkip', 'wizardRetry', 'wizardContinue', 'wizardReopen', 'wizardFocusTab', 'wizardCancel']);
    const [prefs, wizard] = await Promise.all([prefsItem.getValue(), wizardItem.getValue()]);
    if (!IS_SAFARI || !allowed.has(req.type) || !await authorizeSafariGuide(sender, prefs.safariGuideMode, wizard)) throw new Error('Forbidden guide frame');
  }
  // Extension popups have no sender.tab. Check their active window before any reads or effects.
  if (IS_SAFARI) {
    if (sender.tab && sender.tab.incognito !== false) throw new Error('Uzero does not run in private windows.');
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.incognito !== false) throw new Error('Uzero does not run in private windows.');
  }
  switch (req.type) {
    case 'getState':
      return getState();
    case 'refresh':
      await refresh();
      return getState();
    case 'savePrefs': {
      const { prev, next } = await updatePrefs((p) => applyPrefsPatch(p, req.patch));
      if (!sameJson(prev, next)) {
        await syncRules();
        if (prev.pinEnabled !== next.pinEnabled) await syncAlarm(next.pinEnabled);
        if (IS_SAFARI && prev.safariGuideMode !== next.safariGuideMode) {
          const w = await wizardItem.getValue();
          await removeSafariGuide(w);
          if (w && (w.phase === 'confirm' || guideRunning(w))) {
            const id = await showSafariGuide(next.safariGuideMode, w, true);
            if (id !== undefined) await wizardStep({ type: 'pageOpened', tabId: id });
            else if (w.phase === 'confirm') {
              const confirmation = await showReorderPage(undefined);
              if (confirmation !== undefined) await wizardStep({ type: 'pageOpened', tabId: confirmation });
            }
          }
        }
      }
      return next;
    }
    case 'switchActiveTab':
      return switchActiveTab(req.email);
    case 'openService':
      return openService(req.serviceId, req.email);
    case 'listServices':
      return SERVICES.map(toServiceInfo);
    case 'activeTabService':
      return activeTabService();
    case 'wizardOpen': {
      const fromPage = sender.url?.startsWith(browser.runtime.getURL(REORDER_PAGE)) ? sender.tab?.id : undefined;
      const fromPanel = !!sender.url?.startsWith(browser.runtime.getURL(PANEL_PAGE));
      return wizardOpen(req.queue, fromPage, req.panel === true || fromPanel);
    }
    case 'wizardBegin':
      return wizardAction('begin');
    case 'wizardSkip':
      return wizardAction('skip');
    case 'wizardRetry':
      return wizardAction('retry');
    case 'wizardContinue':
      return wizardContinue();
    case 'wizardReopen':
      return wizardReopen();
    case 'wizardFocusTab':
      return wizardFocusTab();
    case 'wizardCancel':
      return wizardCancel();
  }
}

function onMessage(
  msg: unknown,
  sender: Browser.runtime.MessageSender,
  sendResponse: (res: Envelope<unknown>) => void,
): true | undefined {
  if (IS_SAFARI && msg && typeof msg === 'object' && (msg as { type?: unknown }).type === GUIDE_AUTHORIZE) {
    Promise.all([prefsItem.getValue(), wizardItem.getValue()])
      .then(async ([prefs, wizard]) => ({ authorized: await authorizeSafariGuide(sender, prefs.safariGuideMode, wizard) }))
      .then(data => sendResponse({ ok: true, data }), () => sendResponse({ ok: true, data: { authorized: false } }));
    return true;
  }
  if (!isTrustedSender(sender, browser.runtime.id, browser.runtime.getURL('/'))) {
    sendResponse({ ok: false, error: 'Forbidden sender' });
    return undefined;
  }
  const req = parseRequest(msg);
  if (!req) {
    sendResponse({ ok: false, error: 'Invalid message' });
    return undefined;
  }
  handle(req, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (e) => sendResponse({ ok: false, error: errorMessage(e) }),
  );
  return true; // keep the channel open for the async answer
}
